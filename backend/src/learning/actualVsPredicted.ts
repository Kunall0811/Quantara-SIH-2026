/**
 * Actual-vs-Predicted learning loop.
 *
 * Every observation pairs what the optimizer PREDICTED (ETA / distance / traffic) with what was
 * OBSERVED. `source` says where "actual" came from:
 *   MEASURED            – reported by a real vehicle / GPS / mission completion
 *   SIMULATED_EXECUTION – the committed plan re-simulated on the twin's *current* network state
 *                         (i.e. after incidents). Never presented as field data.
 * Observations persist to disk (JSONL) so they survive restarts even with the in-memory DB.
 * Aggregates are computed on demand; below MIN_SAMPLES we say so instead of inventing a trend.
 */
import { appendJsonl, readJsonl, removeData } from '../services/persistence';

export const MIN_SAMPLES = 20;
export type ObsSource = 'MEASURED' | 'SIMULATED_EXECUTION';

export interface Observation {
  id: string; at: string; source: ObsSource;
  planId?: string; vehicleId?: string; deliveryId?: string; driverId?: string; road?: string;
  hourOfDay: number; weather: string;
  predictedEtaMin: number; actualEtaMin: number;
  predictedDistanceKm?: number; actualDistanceKm?: number;
  predictedTraffic?: number; observedTraffic?: number;       // 0..1
}

const FILE = 'observations';
let cache: Observation[] | null = null;
let counter = 0;

function load(): Observation[] { if (!cache) { cache = readJsonl<Observation>(FILE); counter = cache.length; } return cache; }

export function recordObservation(o: Omit<Observation, 'id' | 'at'> & { at?: string }): Observation {
  const all = load();
  const obs: Observation = { ...o, id: `OBS-${String(++counter).padStart(5, '0')}`, at: o.at ?? new Date().toISOString() };
  if (![obs.predictedEtaMin, obs.actualEtaMin].every(Number.isFinite)) throw new Error('Observation needs finite predicted/actual ETA.');
  all.push(obs); appendJsonl(FILE, obs);
  return obs;
}
export function listObservations(limit = 200): Observation[] { return load().slice(-limit); }
export function clearObservations() { cache = []; counter = 0; removeData(FILE); }

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export interface ErrorStats { n: number; maeMin: number; biasMin: number; mapePct: number; rmseMin: number }
export function errorStats(list: Observation[]): ErrorStats {
  const err = list.map((o) => o.actualEtaMin - o.predictedEtaMin);
  const ape = list.filter((o) => o.actualEtaMin > 0).map((o) => Math.abs(o.actualEtaMin - o.predictedEtaMin) / o.actualEtaMin * 100);
  return {
    n: list.length, maeMin: mean(err.map(Math.abs)), biasMin: mean(err), mapePct: mean(ape),
    rmseMin: Math.sqrt(mean(err.map((e) => e * e))),
  };
}

function groupBy(list: Observation[], key: (o: Observation) => string) {
  const m = new Map<string, Observation[]>();
  for (const o of list) { const k = key(o); (m.get(k) ?? m.set(k, []).get(k)!).push(o); }
  return [...m.entries()].map(([k, v]) => ({ key: k, ...errorStats(v) })).sort((a, b) => b.maeMin - a.maeMin);
}

export function summarize(filter?: { source?: ObsSource }) {
  const list = load().filter((o) => !filter?.source || o.source === filter.source);
  if (!list.length) return { status: 'NO_DATA' as const, message: 'No observations recorded yet.', samples: 0 };
  const overall = errorStats(list);
  const sufficient = list.length >= MIN_SAMPLES;
  const traffic = list.filter((o) => o.predictedTraffic !== undefined && o.observedTraffic !== undefined);
  return {
    status: sufficient ? ('OK' as const) : ('INSUFFICIENT_DATA' as const),
    message: sufficient ? `Aggregated over ${list.length} observations.` : `Insufficient historical data: ${list.length} of ${MIN_SAMPLES} observations needed before trends or corrections are reported.`,
    samples: list.length, minSamples: MIN_SAMPLES, overall,
    sources: { measured: list.filter((o) => o.source === 'MEASURED').length, simulatedExecution: list.filter((o) => o.source === 'SIMULATED_EXECUTION').length },
    trafficBiasPctPoints: traffic.length ? mean(traffic.map((o) => (o.observedTraffic! - o.predictedTraffic!) * 100)) : null,
    // dimension breakdowns are only shown once there is enough data to mean something
    byVehicle: sufficient ? groupBy(list, (o) => o.vehicleId ?? 'unknown') : [],
    byWeather: sufficient ? groupBy(list, (o) => o.weather) : [],
    byHour: sufficient ? groupBy(list, (o) => String(o.hourOfDay).padStart(2, '0') + ':00') : [],
    byRoad: sufficient ? groupBy(list.filter((o) => o.road), (o) => o.road!).slice(0, 10) : [],
  };
}

/** Multiplicative ETA correction learned from history (actual ≈ factor × predicted). Advisory only. */
export function etaCorrection() {
  const list = load();
  if (list.length < MIN_SAMPLES) return { available: false as const, factor: 1, samples: list.length, reason: `Insufficient historical data (${list.length}/${MIN_SAMPLES}).` };
  const pred = list.reduce((s, o) => s + o.predictedEtaMin, 0), act = list.reduce((s, o) => s + o.actualEtaMin, 0);
  const raw = pred > 0 ? act / pred : 1;
  const factor = Math.max(0.5, Math.min(2, raw));
  return { available: true as const, factor: Number(factor.toFixed(4)), samples: list.length, reason: `actual/predicted ETA ratio over ${list.length} observations (clamped to 0.5–2.0).` };
}
