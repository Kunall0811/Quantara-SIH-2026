/**
 * SIH Demo Mode — a 21-step scripted walkthrough that is executed for REAL against the digital twin,
 * the optimizer registry, the scenario engine, the learning store and the benchmark engine.
 * Nothing is mocked: each step calls the same code the rest of the platform uses and returns its measured output.
 * State machine: IDLE → RUNNING ⇄ PAUSED → COMPLETED | FAILED. Pause/resume take effect at step boundaries.
 */
import { twin } from '../twin/engine';
import { regret, resilience, predictCongestion, timeWindowReport, explainPlan, routeDnaOf } from '../twin/analytics';
import { summarize, etaCorrection, clearObservations } from '../learning/actualVsPredicted';
import { runBenchmark, DEFAULT_SEEDS } from '../optimization/benchmarkEngine';
import { setLastBenchmark } from '../optimization/benchmarkStore';
import { generateDataset } from '../optimization/datasetGenerator';
import { DEFAULT_WEIGHTS } from '../optimization/fitness';
import { liveTrafficSummary } from '../services/graphService';
import { getIo } from '../socket';
import { Plan } from '../twin/types';

export type DemoStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
export type Src = 'LIVE' | 'SIMULATED' | 'PREDICTED' | 'FALLBACK' | 'MEASURED';
export interface Metric { label: string; value: string; source?: Src }
export interface StepResult {
  summary: string; metrics: Metric[]; source: Src;
  planId?: string; view: 'map' | 'convergence' | 'table' | 'compare' | 'text';
  highlight?: { edgeIds?: string[]; deliveryIds?: string[]; vehicleIds?: string[] };
  data?: any;
}
export interface StepRecord { index: number; id: string; title: string; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; durationMs?: number; result?: StepResult; error?: string }

interface Ctx { basePlanId?: string; qpsoPlanId?: string; accidentEdges: string[]; affectedVehicles: string[]; affectedDeliveries: string[]; brokenVehicle?: string }
export interface DemoOptions { customers?: number; vehicles?: number; seed?: number; delayMs?: number; auto?: boolean; iterations?: number }

const f1 = (n: number) => n.toFixed(1);
const signed = (n: number, u = '', d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}${u}`;

type StepDef = { id: string; title: string; run: (c: Ctx, o: Required<Pick<DemoOptions, 'iterations' | 'seed'>>) => Promise<StepResult> | StepResult };

export const STEPS: StepDef[] = [
  { id: 'load-network', title: 'Load road network', run: () => {
    const s = twin.snapshot();
    return { view: 'map', source: 'SIMULATED', summary: `Pune-centred road graph loaded: ${s.network.nodes} junctions and ${s.network.edges} named roads, each with distance, base speed, type and a risk score.`,
      metrics: [{ label: 'Junctions', value: String(s.network.nodes) }, { label: 'Roads (undirected)', value: String(s.network.edges) }, { label: 'Depot', value: s.depotId }], data: { depotId: s.depotId } };
  } },
  { id: 'load-vehicles', title: 'Load fleet', run: () => ({ view: 'table', source: 'SIMULATED', summary: `${twin.fleet.length} vehicles registered with capacity, fuel type and efficiency.`,
    metrics: twin.fleet.map((v) => ({ label: `${v.id} ${v.fuelType}`, value: `cap ${v.capacity} · ${v.fuelEfficiencyKmPerL} km/${v.fuelType === 'electric' ? 'kWh' : 'unit'}` })), data: { fleet: twin.fleet } }) },
  { id: 'load-deliveries', title: 'Load deliveries', run: () => {
    const d = twin.deliveries; const tw = d.reduce((s, x) => s + (x.windowEnd - x.windowStart), 0) / d.length;
    return { view: 'map', source: 'SIMULATED', summary: `${d.length} deliveries with demand, service time, priority and time windows (average window ${f1(tw)} min).`,
      metrics: [{ label: 'Deliveries', value: String(d.length) }, { label: 'Total demand', value: String(d.reduce((s, x) => s + x.demand, 0)) }, { label: 'Emergency', value: String(d.filter((x) => x.priority === 'emergency').length) }, { label: 'High priority', value: String(d.filter((x) => x.priority === 'high').length) }], data: { deliveries: d } };
  } },
  { id: 'load-traffic', title: 'Load traffic', run: () => {
    const t = liveTrafficSummary();
    return { view: 'map', source: 'SIMULATED', summary: `Traffic state applied to the graph (${t.weather.condition}). Average congestion ${t.avgCongestionPct}%. Source: internal simulation — live TomTom flow is used on the Traffic page when a key is configured.`,
      metrics: [{ label: 'Avg congestion', value: `${t.avgCongestionPct}%`, source: 'SIMULATED' }, { label: 'Road health index', value: String(t.roadHealthIndex) }, { label: 'Severe roads', value: String(t.levels.SEVERE) }], data: t };
  } },
  { id: 'show-twin', title: 'Show digital twin', run: () => {
    const s = twin.snapshot();
    return { view: 'map', source: 'SIMULATED', summary: `Digital twin v${s.version}: network + fleet + deliveries + weather in one state object. Every later step changes THIS state and re-plans from it.`,
      metrics: [{ label: 'Twin version', value: `v${s.version}` }, { label: 'Events applied', value: String(s.events.length) }, { label: 'Weather', value: s.network.weather }], data: { version: s.version } };
  } },
  { id: 'run-qpso', title: 'Run QPSO', run: (c, o) => {
    const p = twin.optimize({ algorithm: 'QPSO', maxIterations: o.iterations, seed: o.seed });
    c.basePlanId = c.qpsoPlanId = p.id;
    return { view: 'map', source: 'SIMULATED', planId: p.id, summary: `QPSO (quantum-inspired, runs on a normal CPU) evaluated ${p.evaluations} candidate plans in ${p.runtimeSeconds.toFixed(2)} s. Fitness ${f1(p.fitness)} · ${p.routes.length} routes · ${f1(p.totals.distanceKm)} km · ${f1(p.totals.totalTimeMin)} min.`,
      metrics: [{ label: 'Fitness (lower = better)', value: f1(p.fitness) }, { label: 'Distance', value: `${f1(p.totals.distanceKm)} km` }, { label: 'Total time', value: `${f1(p.totals.totalTimeMin)} min` }, { label: 'Fuel', value: `₹${p.totals.fuelCostInr.toFixed(0)}` }, { label: 'CO₂', value: `${p.totals.co2Kg.toFixed(2)} kg` }, { label: 'Feasible', value: p.feasible ? 'yes' : 'no' }], data: { dna: p.dnaId } };
  } },
  { id: 'convergence', title: 'Show convergence', run: (c) => {
    const p = twin.getPlan(c.qpsoPlanId!)!; const first = p.convergence[0], last = p.convergence[p.convergence.length - 1];
    return { view: 'convergence', source: 'MEASURED' as Src, planId: p.id, summary: `Best fitness fell from ${f1(first)} to ${f1(last)} (${f1((1 - last / first) * 100)}%) over ${p.iterations} iterations — measured from the run, never smoothed.`,
      metrics: [{ label: 'Start', value: f1(first) }, { label: 'Final', value: f1(last) }, { label: 'Iterations', value: String(p.iterations) }], data: { convergence: p.convergence } };
  } },
  { id: 'show-routes', title: 'Show optimized routes', run: (c) => {
    const p = twin.getPlan(c.qpsoPlanId!)!;
    return { view: 'map', source: 'SIMULATED', planId: p.id, summary: p.routes.map((r) => `${r.vehicleId}: ${r.stops.length} stops, ${f1(r.distanceKm)} km, ${f1(r.totalTimeMin)} min`).join(' · '),
      metrics: p.routes.map((r) => ({ label: r.vehicleId, value: `${r.stops.length} stops · ${r.steps?.length ?? 0} turn-by-turn steps` })), data: { timeWindows: timeWindowReport(p).counts } };
  } },
  { id: 'predict-congestion', title: 'Predict congestion', run: (c) => {
    const pred = predictCongestion(twin, twin.getPlan(c.qpsoPlanId!)!);
    const worst = pred.reduce((m, x) => (x.peak.predictedCongestionPct > m.peak.predictedCongestionPct ? x : m), pred[0]);
    return { view: 'table', source: 'PREDICTED', planId: c.qpsoPlanId, summary: `Predicted congestion on each route over its scheduled hours (current graph congestion × a documented diurnal profile). Worst: ${worst.vehicleId} peaking at ${worst.peak.predictedCongestionPct}% around ${String(worst.peak.hour).padStart(2, '0')}:00.`,
      metrics: pred.map((x) => ({ label: x.vehicleId, value: `now ${x.currentCongestionPct}% → peak ${x.peak.predictedCongestionPct}%`, source: 'PREDICTED' as Src })), data: pred };
  } },
  { id: 'trigger-accident', title: 'Trigger accident', run: async (c) => {
    const { event, impact } = await twin.applyEvent({ type: 'ACCIDENT' });
    c.accidentEdges = event.affectedEdgeIds; c.affectedVehicles = impact?.affectedVehicles ?? []; c.affectedDeliveries = impact?.affectedDeliveries ?? [];
    return { view: 'map', source: 'SIMULATED', planId: c.qpsoPlanId, summary: `${event.description} Twin is now v${twin.version}. Re-simulating the committed plan on the changed network: ${f1(impact!.baselineTotals.totalTimeMin)} → ${f1(impact!.staleTotals.totalTimeMin)} min, lateness ${f1(impact!.staleTotals.latenessMin)} min.`,
      metrics: [{ label: 'Affected roads', value: event.affectedRoadNames.join(', ') || '—' }, { label: 'Plan time (stale)', value: `${f1(impact!.staleTotals.totalTimeMin)} min` }, { label: 'Was', value: `${f1(impact!.baselineTotals.totalTimeMin)} min` }], highlight: { edgeIds: event.affectedEdgeIds }, data: { event } };
  } },
  { id: 'affected-vehicles', title: 'Show affected vehicles', run: (c) => ({ view: 'table', source: 'SIMULATED', planId: c.qpsoPlanId, highlight: { vehicleIds: c.affectedVehicles },
    summary: c.affectedVehicles.length ? `${c.affectedVehicles.join(', ')} ${c.affectedVehicles.length === 1 ? 'is' : 'are'} on routes that cross the accident or slow down because of it.` : 'No vehicle route is materially affected by this incident.',
    metrics: c.affectedVehicles.map((v) => ({ label: v, value: 'route affected' })), data: { vehicles: c.affectedVehicles } }) },
  { id: 'affected-deliveries', title: 'Show affected deliveries', run: (c) => {
    const p = twin.getPlan(c.qpsoPlanId!)!; const ev = twin.evaluatePlanNow(p);
    const late = ev.routes.flatMap((r) => r.stopDetails.filter((s) => s.lateness > 0).map((s) => s.customerId!));
    return { view: 'table', source: 'SIMULATED', planId: p.id, highlight: { deliveryIds: c.affectedDeliveries },
      summary: `${c.affectedDeliveries.length} deliveries are on affected routes; ${late.length} would now miss their time window (${late.join(', ') || 'none'}).`,
      metrics: [{ label: 'On affected routes', value: String(c.affectedDeliveries.length) }, { label: 'Would be late', value: String(late.length) }, { label: 'Total lateness', value: `${f1(ev.latenessMin)} min` }], data: { late } };
  } },
  { id: 'regret', title: 'Compute regret', run: (c, o) => {
    const g = regret(twin, { planId: c.qpsoPlanId, scenarios: [{ name: 'CURRENT_CONDITIONS', requests: [] }], maxIterations: 40, seed: o.seed });
    const r = g.scenarios[0];
    return { view: 'compare', source: 'SIMULATED', planId: c.qpsoPlanId, summary: r.regretFitness > 0 ? `Regret of sticking with the original plan under current conditions: ${f1(r.regretFitness)} fitness points (${f1(r.regretPct)}%) versus ${r.bestAlternative}; that is ${f1(r.regretMin)} operational minutes.` : `Zero regret: no alternative plan (including hindsight re-optimization) beats the original under current conditions — the original plan is still the best known.`,
      metrics: [{ label: 'Regret (fitness)', value: `${f1(r.regretFitness)} (${f1(r.regretPct)}%)` }, { label: 'Selected plan fitness', value: f1(r.selectedFitness) }, { label: 'Best alternative fitness', value: f1(r.bestAlternativeFitness) }, { label: 'Regret (minutes)', value: `${f1(r.regretMin)} min` }], data: g };
  } },
  { id: 'adaptive-qpso', title: 'Run Adaptive QPSO', run: (c, o) => {
    const re = twin.reoptimize({ algorithm: 'AQPSO', maxIterations: o.iterations, seed: o.seed, reason: 'accident' });
    const a = re.after.adaptive!;
    return { view: 'convergence', source: 'SIMULATED', planId: re.after.id, summary: `Adaptive QPSO re-planned around the accident: β varied ${Math.min(...a.betaHistory).toFixed(2)}–${Math.max(...a.betaHistory).toFixed(2)}, ${a.restarts} diversity restart(s). ${f1(re.counterfactual.delayAvoidedMin)} min of delay avoided versus keeping the old plan.`,
      metrics: [{ label: 'New fitness', value: f1(re.after.fitness) }, { label: 'β range', value: `${Math.min(...a.betaHistory).toFixed(2)}–${Math.max(...a.betaHistory).toFixed(2)}` }, { label: 'Restarts', value: String(a.restarts) }, { label: 'Delay avoided', value: `${f1(re.counterfactual.delayAvoidedMin)} min` }], data: { adaptive: a, convergence: re.after.convergence, static: twin.getPlan(c.qpsoPlanId!)!.convergence } };
  } },
  { id: 'reassign-fleet', title: 'Reassign fleet', run: async (c, o) => {
    const victim = twin.currentPlan!.routes.slice().sort((a, b) => b.stops.length - a.stops.length || a.vehicleId.localeCompare(b.vehicleId))[0].vehicleId;
    c.brokenVehicle = victim;
    const { event } = await twin.applyEvent({ type: 'VEHICLE_BREAKDOWN', vehicleId: victim, note: 'demo: engine failure' });
    const re = twin.reoptimize({ algorithm: 'AQPSO', maxIterations: o.iterations, seed: o.seed, reason: event.description });
    const moved = re.diff.reassigned;
    return { view: 'compare', source: 'SIMULATED', planId: re.after.id, highlight: { vehicleIds: [victim] }, summary: `${event.description} ${moved.length} deliveries were reallocated: ${moved.slice(0, 5).map((m) => `${m.deliveryId} ${m.from ?? '—'}→${m.to ?? 'UNSERVED'}`).join(', ')}${moved.length > 5 ? '…' : ''}.`,
      metrics: [{ label: 'Reassigned', value: String(moved.length) }, { label: 'Unserved', value: String(re.after.unassigned.length) }, { label: 'Vehicles now used', value: String(re.after.routes.length) }], data: { diff: re.diff, explanation: re.explanation } };
  } },
  { id: 'recalc-routes', title: 'Recalculate routes', run: () => {
    const p = twin.currentPlan!; const re = twin.lastReoptimization!;
    return { view: 'map', source: 'SIMULATED', planId: p.id, summary: `Final plan ${p.dnaId}: ${p.routes.map((r) => `${r.vehicleId} ${f1(r.totalTimeMin)} min`).join(', ')}. Turn-by-turn directions regenerated for every route.`,
      metrics: [{ label: 'Distance', value: `${f1(p.totals.distanceKm)} km (${signed(re.diff.delta.distanceKm, ' km')})` }, { label: 'Time', value: `${f1(p.totals.totalTimeMin)} min (${signed(re.diff.delta.timeMin, ' min')})` }, { label: 'Fuel', value: `₹${p.totals.fuelCostInr.toFixed(0)} (${signed(re.diff.delta.fuelCostInr, '', 0)})` }, { label: 'CO₂', value: `${p.totals.co2Kg.toFixed(2)} kg (${signed(re.diff.delta.co2Kg, ' kg', 2)})` }], data: { explanation: re.explanation } };
  } },
  { id: 'resilience', title: 'Show resilience', run: (_c, o) => {
    const r = resilience(twin, { maxIterations: 30, seed: o.seed });
    return { view: 'table', source: 'SIMULATED', planId: twin.currentPlanId ?? undefined, summary: `Resilience score ${r.score}/100 from ${r.scenarios.length} simulated scenarios; worst-case delay ${f1(r.worstCaseDelayMin)} min. ${r.methodology}`,
      metrics: r.scenarios.map((s) => ({ label: s.scenario, value: `${s.survived ? 'survives' : s.recoveredByReoptimization ? 'recoverable' : 'fails'} · ${signed(s.delayMin, ' min')}` })), data: r };
  } },
  { id: 'counterfactual', title: 'Counterfactual: WITHOUT vs WITH re-optimization', run: () => {
    const re = twin.lastReoptimization!; const cf = re.counterfactual;
    return { view: 'compare', source: 'SIMULATED', planId: re.after.id, summary: `After the last disruption: WITHOUT re-optimization the old plan takes ${f1(cf.withoutReoptimization.totalTimeMin)} min with ${cf.withoutReoptimization.unassigned} unserved; WITH it ${f1(cf.withReoptimization.totalTimeMin)} min with ${cf.withReoptimization.unassigned} unserved.`,
      metrics: [{ label: 'Delay avoided', value: `${f1(cf.delayAvoidedMin)} min` }, { label: 'Time saved', value: `${f1(cf.timeSavedMin)} min` }, { label: 'Fuel saved', value: `₹${cf.fuelSavedInr.toFixed(0)}` }, { label: 'CO₂ saved', value: `${cf.co2SavedKg.toFixed(2)} kg` }, { label: 'Deliveries recovered', value: String(cf.deliveriesRecovered) }], data: cf };
  } },
  { id: 'actual-vs-predicted', title: 'Actual vs predicted', run: (c) => {
    const ex = twin.simulateExecution(c.basePlanId, true); const s = summarize(); const cor = etaCorrection();
    const err = ex.rows.length ? ex.rows.reduce((a, r) => a + r.errorMin, 0) / ex.rows.length : 0;
    return { view: 'table', source: 'SIMULATED', planId: c.basePlanId, summary: `Executing the ORIGINAL plan on the disrupted network gives a mean ETA error of ${signed(err, ' min')} across ${ex.rows.length} stops (labelled SIMULATED_EXECUTION, not field data). ${s.message}`,
      metrics: [{ label: 'Mean ETA error', value: `${signed(err, ' min')}` }, { label: 'Observations stored', value: String(s.samples) }, { label: 'Correction factor', value: cor.available ? `×${cor.factor}` : 'insufficient data' }], data: { rows: ex.rows.slice(0, 40), summary: s } };
  } },
  { id: 'friday', title: 'FRIDAY explains', run: (c) => {
    const p = twin.currentPlan!; const ex = explainPlan(p); const dna = routeDnaOf(p);
    const re = twin.lastReoptimization;
    return { view: 'text', source: 'SIMULATED', planId: p.id, summary: ex.sentences.join(' '),
      metrics: [{ label: 'Route DNA', value: dna.id }, { label: 'Top driver', value: `${ex.factors[0].factor} (${ex.factors[0].sharePct}%)` }, { label: 'Why changed', value: re ? `${re.diff.reassigned.length} reassignments` : '—' }], data: { explanation: ex, why: re?.explanation, dna } };
  } },
  { id: 'benchmark', title: 'Benchmark summary', run: (_c, o) => {
    const ds = generateDataset(26137, 8, 3, twin.graph.clone(), 'pune-hub', { startTimeMin: 540, capacityHeadroom: 1.4 });
    const rep = runBenchmark({ graph: twin.graph.clone(), depotId: 'pune-hub', customers: ds.customers, fleet: ds.fleet, weights: DEFAULT_WEIGHTS, weather: { rainMm: 0, weatherSeverity: 0 }, populationSize: 30, maxIterations: Math.min(o.iterations, 60), startTimeMin: 540 }, { seeds: DEFAULT_SEEDS, datasetLabel: 'SIH demo · 8 customers · 3 vehicles (clean network)' });
    setLastBenchmark(rep);
    const q = rep.results.QPSO, aq = rep.results.AQPSO;
    return { view: 'table', source: 'MEASURED', summary: `Real benchmark, seeds ${rep.meta.seeds.join('/')}: ${rep.ranking.map((r) => `${r.algorithm} ${f1(r.meanFitness)}`).join(' < ')}. ${aq?.vsQPSO ? `AQPSO vs QPSO: ${aq.vsQPSO.verdict} (p=${aq.vsQPSO.pValue.toFixed(3)}).` : ''} EXACT gap reported only where exhaustive search finished.`,
      metrics: rep.ranking.map((r) => ({ label: r.algorithm, value: `mean ${f1(r.meanFitness)}${rep.results[r.algorithm].optimalityGapPct != null ? ` · gap ${rep.results[r.algorithm].optimalityGapPct!.toFixed(2)}%` : ''}`, source: 'MEASURED' as Src })), data: { meta: rep.meta, ranking: rep.ranking, qpso: q?.meanFitness } };
  } },
];

class DemoRunner {
  status: DemoStatus = 'IDLE';
  steps: StepRecord[] = STEPS.map((s, i) => ({ index: i + 1, id: s.id, title: s.title, status: 'PENDING' }));
  current = 0; opts: Required<DemoOptions> = { customers: 10, vehicles: 4, seed: 42, delayMs: 2500, auto: true, iterations: 60 };
  ctx: Ctx = { accidentEdges: [], affectedVehicles: [], affectedDeliveries: [] };
  startedAt: string | null = null; finishedAt: string | null = null; error: string | null = null;
  private gen = 0;
  private pauseRequested = false; private loop: Promise<void> | null = null; private timer: NodeJS.Timeout | null = null; private wake: (() => void) | null = null;

  state() { return { status: this.status, current: this.current, total: STEPS.length, steps: this.steps, options: this.opts, startedAt: this.startedAt, finishedAt: this.finishedAt, error: this.error, twinVersion: twin.version }; }
  private emit() { getIo()?.emit('demo_state', { status: this.status, current: this.current, total: STEPS.length, step: this.steps[Math.max(0, this.current - 1)] }); }

  reset() {
    this.gen++; this.stopLoop(); this.status = 'IDLE'; this.current = 0; this.error = null; this.startedAt = null; this.finishedAt = null; this.pauseRequested = false;
    this.steps = STEPS.map((s, i) => ({ index: i + 1, id: s.id, title: s.title, status: 'PENDING' }));
    this.ctx = { accidentEdges: [], affectedVehicles: [], affectedDeliveries: [] };
    twin.load({ customers: this.opts.customers, vehicles: this.opts.vehicles, seed: this.opts.seed }); clearObservations();
    this.emit(); return this.state();
  }

  async start(o: DemoOptions = {}) {
    if (this.status === 'RUNNING') return this.state();
    this.opts = { ...this.opts, ...o, delayMs: o.delayMs ?? this.opts.delayMs, auto: o.auto ?? true } as Required<DemoOptions>;
    this.reset(); this.status = 'RUNNING'; this.startedAt = new Date().toISOString();
    this.loop = this.run(); this.emit();
    if (this.opts.delayMs === 0 && this.opts.auto) await this.loop;      // synchronous mode (tests / CLI)
    return this.state();
  }
  pause() { if (this.status === 'RUNNING') { this.pauseRequested = true; if (!this.stepInFlight) { this.status = 'PAUSED'; this.emit(); this.wake?.(); } } return this.state(); }
  resume() { if (this.status === 'PAUSED') { this.pauseRequested = false; this.status = 'RUNNING'; this.emit(); this.wake?.(); if (!this.loop) this.loop = this.run(); } return this.state(); }
  /** manual single-step (auto=false mode) */
  async next() {
    if (this.status === 'IDLE') { this.opts.auto = false; this.reset(); this.status = 'PAUSED'; this.startedAt = new Date().toISOString(); }
    if (this.status === 'PAUSED' && this.current < STEPS.length) await this.execute(this.current);
    return this.state();
  }

  private stepInFlight = false;
  private stopLoop() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.wake?.(); this.loop = null; this.pauseRequested = true; this.wake = null; }
  private sleep(ms: number) { return new Promise<void>((res) => { this.wake = res; this.timer = setTimeout(res, ms); }); }

  private async execute(i: number) {
    const def = STEPS[i]; const rec = this.steps[i]; const t0 = performance.now(); const gen = this.gen;
    rec.status = 'RUNNING'; this.stepInFlight = true; this.emit();
    try {
      const result = await def.run(this.ctx, { iterations: this.opts.iterations, seed: this.opts.seed });
      if (gen !== this.gen) return;                       // demo was reset while this step was running — discard
      rec.result = result;
      rec.status = 'DONE'; rec.durationMs = Math.round(performance.now() - t0); this.current = i + 1;
      if (this.current >= STEPS.length) { this.status = 'COMPLETED'; this.finishedAt = new Date().toISOString(); }
    } catch (e: any) {
      if (gen !== this.gen) return;
      rec.status = 'FAILED'; rec.error = e?.message ?? String(e); this.error = `Step ${i + 1} (${def.title}) failed: ${rec.error}`; this.status = 'FAILED';
    } finally { this.stepInFlight = false; this.emit(); }
  }

  private async run() {
    this.pauseRequested = false;
    while (this.current < STEPS.length && this.status === 'RUNNING') {
      await this.execute(this.current);
      if (this.status !== 'RUNNING') break;
      if (this.pauseRequested) { this.status = 'PAUSED'; this.emit(); break; }
      if (this.current < STEPS.length && this.opts.delayMs > 0) await this.sleep(this.opts.delayMs);
      if (this.pauseRequested && this.status === 'RUNNING') { this.status = 'PAUSED'; this.emit(); break; }
    }
    this.loop = null;
  }
}

export const demo = new DemoRunner();
export type { Plan };
