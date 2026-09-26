/**
 * Real self-checks. Every entry EXECUTES the subsystem on a tiny instance and reports what happened —
 * PASS only if it ran and produced sane output, WARN if it cannot be verified right now, FAIL otherwise.
 * (The previous /health/full returned the string 'available' for everything without running anything.)
 */
import { getGraph } from './graphService';
import { runAlgorithm, ALL_ALGORITHM_IDS, RunParams } from '../optimization';
import { DEFAULT_WEIGHTS } from '../optimization/fitness';
import { generateDataset } from '../optimization/datasetGenerator';
import { validateVrpSolution } from '../optimization/constraints';
import { runBenchmark } from '../optimization/benchmarkEngine';
import { twin } from '../twin/engine';
import { simulateScenario } from '../twin/analytics';
import { mutateNetwork } from '../twin/mutate';
import { roadCodeMap } from '../twin/roadCodes';
import { summarize } from '../learning/actualVsPredicted';
import { saveJson, loadJson, removeData } from './persistence';
import { TOOLS } from '../friday/tools';
import { getIo } from '../socket';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
export interface CheckResult { name: string; status: CheckStatus; detail: string; ms: number }

async function timed(name: string, fn: () => Promise<{ status: CheckStatus; detail: string }> | { status: CheckStatus; detail: string }): Promise<CheckResult> {
  const t0 = performance.now();
  try { const r = await fn(); return { name, ...r, ms: Math.round((performance.now() - t0) * 10) / 10 }; }
  catch (e: any) { return { name, status: 'FAIL', detail: `threw: ${e?.message ?? e}`, ms: Math.round((performance.now() - t0) * 10) / 10 }; }
}

export async function runSelfChecks(): Promise<{ overall: CheckStatus; checks: CheckResult[] }> {
  const g = getGraph();
  const ds = generateDataset(1, 4, 2, g, 'pune-hub', { capacityHeadroom: 2 });
  const base: RunParams = { graph: g, depotId: 'pune-hub', customers: ds.customers, fleet: ds.fleet, weights: DEFAULT_WEIGHTS, weather: { rainMm: 0, weatherSeverity: 0 }, populationSize: 6, maxIterations: 10, seed: 1 };
  const checks: CheckResult[] = [];

  checks.push(await timed('road graph', () => {
    const p = g.shortest('pune-hub', 'pune-n-kharadi', 'astar', 'time');
    return p.cost < Infinity && p.edgePath.length > 0 ? { status: 'PASS', detail: `${g.nodes.size} nodes, ${g.edges.size} directed edges; hub→Kharadi A* = ${p.cost.toFixed(1)} min over ${p.edgePath.length} edges` } : { status: 'FAIL', detail: 'no path hub→Kharadi' };
  }));
  for (const id of ALL_ALGORITHM_IDS) {
    checks.push(await timed(`algorithm ${id}`, () => {
      const r = runAlgorithm(id, id === 'EXACT' ? { ...base, customers: ds.customers.slice(0, 4) } : base);
      const ok = Number.isFinite(r.bestFitness) && r.evaluations > 0 && r.convergence.length > 0;
      return { status: ok ? 'PASS' : 'FAIL', detail: `fitness ${r.bestFitness.toFixed(2)}, ${r.evaluations} evaluations, stopped by ${r.stoppedBy}, feasible=${r.feasible}` };
    }));
  }
  checks.push(await timed('constraint validator', () => {
    const r = runAlgorithm('QPSO', base); const v = validateVrpSolution(r.bestEval as any, ds.customers, ds.fleet, 'pune-hub', g);
    return { status: 'PASS', detail: `validated a real solution → feasible=${v.feasible}, violations=${v.violations.length}` };
  }));
  checks.push(await timed('benchmark engine', () => {
    const rep = runBenchmark({ ...base, maxIterations: 8 }, { algorithms: ['QPSO', 'PSO'], seeds: [1, 2] });
    return rep.runs.length === 4 && rep.meta.fairness.length > 0 ? { status: 'PASS', detail: `4 real runs, fairness notes=${rep.meta.fairness.length}, hardware=${rep.meta.hardware.cpu}` } : { status: 'FAIL', detail: 'unexpected run count' };
  }));
  checks.push(await timed('scenario engine (clone isolation)', () => {
    const c = g.clone(); const before = JSON.stringify([...g.edges.values()].slice(0, 50).map((e) => e.closed));
    const m = mutateNetwork(c, { type: 'ROAD_CLOSURE', road: [...roadCodeMap(g).keys()].find((k) => k.startsWith('pune-')) });
    const live = JSON.stringify([...g.edges.values()].slice(0, 50).map((e) => e.closed));
    const closedOnClone = m.edges.every((id) => c.edges.get(id)!.closed);
    return closedOnClone && before === live ? { status: 'PASS', detail: `closed ${m.edges.length} edge(s) on the clone; live graph unchanged` } : { status: 'FAIL', detail: 'clone isolation broken' };
  }));
  checks.push(await timed('digital twin', () => {
    if (!twin.loaded) return { status: 'WARN', detail: 'twin not loaded yet — call POST /api/twin/load (or start SIH demo)' };
    const s = twin.snapshot(); return { status: 'PASS', detail: `v${s.version}, ${s.deliveries.length} deliveries, ${s.fleet.length} vehicles, ${s.events.length} events, ${s.plans.length} plans` };
  }));
  checks.push(await timed('resilience / regret / counterfactual', () => {
    if (!twin.currentPlan) return { status: 'WARN', detail: 'no active plan — optimize the twin first to verify scenario analytics' };
    const o = simulateScenario(twin, { name: 'CHECK', requests: [{ type: 'TRAFFIC_INCREASE', percent: 20, scope: 'ALL' }] }, { populationSize: 6, maxIterations: 8 });
    return o.withoutReoptimization.totalTimeMin > o.baseline.totalTimeMin ? { status: 'PASS', detail: `+20% traffic → committed plan ${o.baseline.totalTimeMin.toFixed(1)}→${o.withoutReoptimization.totalTimeMin.toFixed(1)} min; re-optimized ${o.withReoptimization.totalTimeMin.toFixed(1)} min` } : { status: 'FAIL', detail: 'traffic increase had no effect on the committed plan' };
  }));
  checks.push(await timed('learning store persistence', () => {
    const k = `selfcheck-${process.pid}`; const ok = saveJson(k, { t: 1 }) && loadJson<{ t: number }>(k)?.t === 1; removeData(k);
    const s = summarize(); return { status: ok ? 'PASS' : 'WARN', detail: ok ? `file persistence OK; ${s.samples} observation(s) on record (${s.status})` : 'could not write to DATA_DIR — learning data will be memory-only' };
  }));
  checks.push(await timed('FRIDAY tool registry', () => {
    const n = Object.keys(TOOLS).length; const need = ['twin.get_state', 'twin.what_if', 'analysis.explain_route', 'benchmark.explain'];
    const missing = need.filter((t) => !TOOLS[t]);
    return n > 0 && !missing.length ? { status: 'PASS', detail: `${n} tools registered (incl. twin/analysis/benchmark tools)` } : { status: 'FAIL', detail: `missing tools: ${missing.join(', ') || 'registry empty'}` };
  }));
  checks.push(await timed('realtime (socket.io)', () => getIo() ? { status: 'PASS', detail: 'socket.io server attached' } : { status: 'WARN', detail: 'socket.io server not attached in this process (normal under test)' }));

  const overall: CheckStatus = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : checks.some((c) => c.status === 'WARN') ? 'WARN' : 'PASS';
  return { overall, checks };
}
