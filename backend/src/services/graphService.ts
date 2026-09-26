import { RoadGraph, TrafficLevel } from '../optimization/graph';
import { buildIndiaGraph } from '../data/indiaGraph';
import { mulberry32 } from '../optimization/rng';
import { env } from '../config/env';

/** Seeded stream for ambient (simulated) drift — reproducible for a given TWIN_SEED. OTP/auth code never uses this. */
let driftRand = mulberry32(env.TWIN_SEED);
export function reseedDrift(seed = env.TWIN_SEED) { driftRand = mulberry32(seed); }

let graph: RoadGraph | null = null;
export let currentWeather = { condition: 'Clear Sky', rainMmPerH: 0, visibility: 'High' };

export function getGraph(): RoadGraph {
  if (!graph) graph = buildIndiaGraph();
  return graph;
}

export function resetGraph() {
  graph = buildIndiaGraph();
  currentWeather = { condition: 'Clear Sky', rainMmPerH: 0, visibility: 'High' };
  reseedDrift(); appliedCongestionAdd = 0;
}

function randomLevel(rand: () => number): TrafficLevel {
  const r = rand();
  if (r < 0.55) return 'LOW';
  if (r < 0.8) return 'MODERATE';
  if (r < 0.95) return 'HIGH';
  return 'SEVERE';
}

/** Small continuous background drift so the demo feels alive without a manual trigger. */
export function applyRandomFluctuation(intensity = 0.1): string[] {
  if (!env.TWIN_BACKGROUND_DRIFT) return [];
  const g = getGraph();
  const changed: string[] = [];
  const rnd = driftRand;
  for (const [id, e] of g.edges) {
    if (e.closed || id.endsWith('_r')) continue;
    if (rnd() < intensity) {
      e.trafficLevel = randomLevel(rnd);
      e.congestionPct = { LOW: 0.05 + rnd() * 0.15, MODERATE: 0.2 + rnd() * 0.25,
        HIGH: 0.45 + rnd() * 0.25, SEVERE: 0.7 + rnd() * 0.25 }[e.trafficLevel];
      const rev = g.edges.get(id + '_r');
      if (rev) { rev.trafficLevel = e.trafficLevel; rev.congestionPct = e.congestionPct; }
      changed.push(id);
    }
  }
  return changed;
}

export function setEdgeTraffic(edgeId: string, level: TrafficLevel, congestionPct?: number) {
  const g = getGraph();
  for (const suffix of ['', '_r']) {
    const e = g.edges.get(edgeId + suffix) || g.edges.get(edgeId.replace('_r', '') + suffix);
    if (e) {
      e.trafficLevel = level;
      if (congestionPct !== undefined) e.congestionPct = congestionPct;
    }
  }
}

export function closeEdge(edgeId: string) {
  const g = getGraph();
  for (const suffix of ['', '_r']) {
    const e = g.edges.get(edgeId + suffix);
    if (e) { e.closed = true; e.trafficLevel = 'SEVERE'; e.congestionPct = 1; }
  }
}

export function reopenEdge(edgeId: string) {
  const g = getGraph();
  for (const suffix of ['', '_r']) {
    const e = g.edges.get(edgeId + suffix);
    if (e) { e.closed = false; e.trafficLevel = 'LOW'; e.congestionPct = 0.1; }
  }
}

export function pickRandomOpenEdge(cityKey?: string): string | null {
  const g = getGraph();
  let open = [...g.edges.values()].filter((e) => !e.closed && !e.id.endsWith('_r'));
  if (cityKey) {
    open = open.filter((e) => e.id.startsWith(`${cityKey}-`));
  }
  if (!open.length) return null;
  return open[Math.floor(driftRand() * open.length)].id;
}

export function triggerRushHour() {
  const g = getGraph();
  for (const e of g.edges.values()) {
    if (e.closed) continue;
    if (e.id.endsWith('_r')) continue;
    if ((e.roadType === 'highway' || e.roadType === 'arterial') && driftRand() < 0.6) {
      e.trafficLevel = driftRand() < 0.5 ? 'HIGH' : 'SEVERE';
      e.congestionPct = 0.55 + driftRand() * 0.35;
      const rev = g.edges.get(e.id + '_r');
      if (rev) { rev.trafficLevel = e.trafficLevel; rev.congestionPct = e.congestionPct; }
    }
  }
}

/**
 * Weather is applied as an IDEMPOTENT network-wide speed factor (graph.globalSpeedFactor) plus a
 * one-off congestion bump recorded on first application — calling it twice with the same weather
 * no longer compounds (the previous implementation multiplied every road's base speed each call).
 */
export const WEATHER_MODEL: Record<string, { speed: number; congestionAdd: number; rainMmPerH: number; visibility: string; severity: number }> = {
  'Clear Sky': { speed: 1, congestionAdd: 0, rainMmPerH: 0, visibility: 'High', severity: 0 },
  'Light Rain': { speed: 0.9, congestionAdd: 0.1, rainMmPerH: 5, visibility: 'High', severity: 0.25 },
  'Heavy Rain': { speed: 0.7, congestionAdd: 0.25, rainMmPerH: 35, visibility: 'Medium', severity: 0.6 },
  'Dense Fog': { speed: 0.6, congestionAdd: 0.15, rainMmPerH: 0, visibility: 'Low', severity: 0.5 },
  Storm: { speed: 0.35, congestionAdd: 0.4, rainMmPerH: 95, visibility: 'Very Low', severity: 1 },
};
let appliedCongestionAdd = 0;

export function triggerSimulation(type: 'Clear Sky' | 'Light Rain' | 'Heavy Rain' | 'Dense Fog' | 'Storm') {
  const g = getGraph();
  const m = WEATHER_MODEL[type] ?? WEATHER_MODEL['Clear Sky'];
  const delta = m.congestionAdd - appliedCongestionAdd;      // only the difference vs. what is already applied
  for (const e of g.edges.values()) {
    if (e.closed) continue;
    e.congestionPct = Math.max(0, Math.min(1, e.congestionPct + delta));
    if (e.congestionPct > 0.85) e.trafficLevel = 'SEVERE';
    else if (e.congestionPct > 0.6) e.trafficLevel = 'HIGH';
    else if (e.congestionPct > 0.3) e.trafficLevel = 'MODERATE';
    else e.trafficLevel = 'LOW';
  }
  appliedCongestionAdd = m.congestionAdd;
  g.globalSpeedFactor = m.speed;
  currentWeather = { condition: type, rainMmPerH: m.rainMmPerH, visibility: m.visibility };
}

export function liveTrafficSummary() {
  const g = getGraph();
  const edges = [...g.edges.values()].filter((e) => !e.id.endsWith('_r'));
  const levels: Record<TrafficLevel, number> = { LOW: 0, MODERATE: 0, HIGH: 0, SEVERE: 0 };
  let congestionSum = 0;
  for (const e of edges) { levels[e.trafficLevel]++; congestionSum += e.congestionPct; }
  
  const avgCongestionPct = edges.length ? Math.round((congestionSum / edges.length) * 1000) / 10 : 0;
  
  const vehicleVolume = avgCongestionPct; 
  let rhi = 100 - (currentWeather.rainMmPerH * 0.4) - (vehicleVolume * 0.35);
  rhi = Math.max(0, Math.min(100, Math.round(rhi)));

  return {
    avgCongestionPct,
    levels, totalEdges: edges.length,
    weather: currentWeather,
    roadHealthIndex: rhi
  };
}
