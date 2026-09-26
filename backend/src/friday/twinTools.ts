/**
 * FRIDAY tools grounded in the digital twin. Every one reads REAL state (twin, plans, benchmark store,
 * learning store) and returns a deterministic `reply` built from that data, so spoken numbers always match
 * what the panels show. `what_if` runs on a CLONE and never mutates the live twin; `apply_event` does mutate
 * it and is a confirmation-required write tool.
 */
import { twin } from '../twin/engine';
import { simulateScenario, resilience, regret, timeWindowReport, explainPlan, routeDnaOf } from '../twin/analytics';
import { EventRequest, TwinEventType } from '../twin/types';
import { summarize, etaCorrection } from '../learning/actualVsPredicted';
import { getLastBenchmark, setLastBenchmarkIfEmpty } from '../optimization/benchmarkStore';
import { runBenchmark } from '../optimization/benchmarkEngine';
import { generateDataset } from '../optimization/datasetGenerator';
import { DEFAULT_WEIGHTS } from '../optimization/fitness';
import { ALGORITHM_LABELS, AlgorithmId } from '../optimization';
import { getGraph } from '../services/graphService';
import { demo } from '../demo/sihDemo';

type Tool = (p: any) => Promise<any>;
const f1 = (n: number) => n.toFixed(1);
const NEED_PLAN = { error: 'There is no active plan yet. Ask me to optimize the digital twin first.', reply: 'There is no active plan yet — ask me to optimize the digital twin first.' };
const ready = () => { twin.ensureLoaded(); return twin.currentPlan; };

export function eventFromParams(p: any): EventRequest | { error: string } {
  const type = (p.eventType ?? p.type) as TwinEventType | undefined;
  if (!type) return { error: 'I could not tell which disruption you mean (closure, accident, traffic increase, breakdown or weather).' };
  const req: EventRequest = { type };
  if (p.road) req.road = p.road; if (p.vehicleId) req.vehicleId = p.vehicleId; if (p.percent) req.percent = p.percent; if (p.condition) req.condition = p.condition; if (p.scope) req.scope = p.scope;
  if ((type === 'ROAD_CLOSURE' || type === 'ACCIDENT') && !req.road) return req;    // engine picks the plan's busiest road
  if (type === 'TRAFFIC_INCREASE') { req.percent = req.percent ?? 30; req.scope = req.scope ?? (req.road ? 'ROAD' : 'ALL'); }
  if (type === 'WEATHER_CHANGE') req.condition = req.condition ?? 'Heavy Rain';
  return req;
}

const ALGO_TEXT: Record<string, string> = {
  QPSO: 'QPSO is Quantum-behaved Particle Swarm Optimization. It is quantum-INSPIRED: it borrows the idea of a probabilistic position cloud around an attractor from quantum mechanics, but it runs on an ordinary CPU — it is not quantum computing and uses no quantum hardware.',
  AQPSO: 'Adaptive QPSO adjusts its contraction-expansion coefficient beta every iteration from measured swarm diversity and stagnation, and re-seeds the worst particles when the search stalls. It is still a classical, quantum-inspired algorithm — no quantum hardware is involved.',
  PSO: 'PSO is classical Particle Swarm Optimization: particles move using velocity, a personal best and a global best. QPSO removes the velocity term and samples positions from a distribution around a local attractor instead.',
  GA: 'The Genetic Algorithm evolves a population of visiting orders using selection, crossover and mutation.',
  SA: 'Simulated Annealing improves a single solution by accepting worse moves with a probability that shrinks as the temperature falls.',
  EXACT: 'The exact solver exhaustively evaluates every ordering of the deliveries, so it is optimal inside the decoded search space, but it is only practical for about nine deliveries or fewer.',
  OBJECTIVE: 'Every algorithm minimises the same objective: weighted distance, travel time, traffic, fuel cost, risk, weather and turns, plus penalties for unreachable legs, unassigned deliveries and late arrivals. Lower is better, and the terms add up exactly to the fitness.',
};

export const TWIN_TOOLS: Record<string, Tool> = {
  'twin.get_state': async () => {
    twin.ensureLoaded(); const s = twin.snapshot(); const p = twin.currentPlan;
    const reply = `Digital twin v${s.version}: ${s.network.nodes} junctions, ${s.network.edges} roads (${s.network.closed} closed), weather ${s.network.weather}. ${s.fleet.filter((v) => v.available).length} of ${s.fleet.length} vehicles available, ${s.deliveries.length} deliveries, ${s.events.length} event(s) applied. ${p ? `Active plan ${p.dnaId}: ${f1(p.totals.distanceKm)} km, ${f1(p.totals.totalTimeMin)} min, fitness ${f1(p.fitness)}.` : 'No plan has been computed yet.'}`;
    return { grounded: true, reply, version: s.version, network: s.network, events: s.events.map((e) => e.description), plan: p ? { id: p.id, dnaId: p.dnaId, fitness: p.fitness, totals: p.totals } : null, action: { type: 'NAVIGATE', page: 'twin' } };
  },
  'twin.optimize': async (p) => {
    twin.ensureLoaded(); const algorithm = (p.algorithm ?? 'QPSO') as AlgorithmId;
    if (algorithm === 'EXACT' && twin.customers().length > 9) return { error: 'EXACT is limited to 9 deliveries.', reply: 'The exact solver is limited to nine deliveries; pick another algorithm.' };
    const plan = twin.optimize({ algorithm, maxIterations: 80 });
    return { grounded: true, reply: `${ALGORITHM_LABELS[algorithm]} planned ${plan.dataset.customers} deliveries across ${plan.routes.length} vehicles: ${f1(plan.totals.distanceKm)} km, ${f1(plan.totals.totalTimeMin)} min, fitness ${f1(plan.fitness)}, ${plan.evaluations} evaluations in ${plan.runtimeSeconds.toFixed(2)} s.${plan.unassigned.length ? ` ${plan.unassigned.length} deliveries could not be served.` : ''}`, planId: plan.id, dnaId: plan.dnaId, action: { type: 'REFRESH_TWIN' } };
  },
  'twin.what_if': async (p) => {
    if (!ready()) return NEED_PLAN;
    const req = eventFromParams(p); if ('error' in req) return { ...req, reply: req.error };
    const o = simulateScenario(twin, { name: 'WHAT_IF', requests: [req] }, { maxIterations: 40 });
    const a = o.baseline, b = o.withoutReoptimization, c = o.withReoptimization;
    const reply = `SIMULATED what-if (the live twin is unchanged): ${o.description} Keeping the current plan: ${f1(a.totalTimeMin)} → ${f1(b.totalTimeMin)} min (${b.totalTimeMin >= a.totalTimeMin ? '+' : ''}${f1(b.totalTimeMin - a.totalTimeMin)}), ${b.unassigned} unserved, ${f1(b.latenessMin)} min lateness. Re-optimizing: ${f1(c.totalTimeMin)} min, ${c.unassigned} unserved. Affected vehicles: ${o.affectedVehicles.join(', ') || 'none'}.`;
    return { grounded: true, reply, label: 'SIMULATED', outcome: { description: o.description, baseline: a, withoutReoptimization: b, withReoptimization: c, counterfactual: o.counterfactual, affectedVehicles: o.affectedVehicles, affectedDeliveries: o.affectedDeliveries } };
  },
  'twin.apply_event': async (p) => {
    twin.ensureLoaded(); const req = eventFromParams(p); if ('error' in req) return { ...req, reply: req.error };
    const { event, impact } = await twin.applyEvent(req);
    const reply = `Applied to the live twin (now v${twin.version}): ${event.description}${impact ? ` The committed plan now takes ${f1(impact.staleTotals.totalTimeMin)} min instead of ${f1(impact.baselineTotals.totalTimeMin)}; affected vehicles: ${impact.affectedVehicles.join(', ') || 'none'}. Say "re-optimize" to replan.` : ''}`;
    return { grounded: true, reply, event, impact, action: { type: 'REFRESH_TWIN' } };
  },
  'twin.reoptimize': async (p) => {
    if (!ready()) return NEED_PLAN;
    const re = twin.reoptimize({ algorithm: p.algorithm ?? 'AQPSO', maxIterations: 80, reason: 'requested via FRIDAY' });
    return { grounded: true, reply: re.explanation.slice(0, 5).join(' '), diff: { reassigned: re.diff.reassigned, delta: re.diff.delta }, counterfactual: re.counterfactual, mode: re.mode, action: { type: 'REFRESH_TWIN' } };
  },
  'analysis.explain_route': async () => {
    const p = ready(); if (!p) return NEED_PLAN; const ex = explainPlan(p);
    return { grounded: true, reply: ex.sentences.join(' '), factors: ex.factors, dnaId: ex.dnaId, identityHolds: ex.identity };
  },
  'analysis.route_dna': async () => {
    const p = ready(); if (!p) return NEED_PLAN; const d = routeDnaOf(p);
    return { grounded: true, reply: `Route DNA ${d.id}: ${d.algorithm}, seed ${d.seed}, dataset fingerprint ${d.datasetFingerprint}, twin v${d.twinVersion}, fitness ${f1(d.fitness)}. The same inputs always reproduce this ID.`, dna: d };
  },
  'analysis.resilience': async () => {
    if (!ready()) return NEED_PLAN; const r = resilience(twin, { maxIterations: 30 });
    const worst = r.scenarios.slice().sort((a, b) => b.delayMin - a.delayMin)[0];
    return { grounded: true, label: 'SIMULATED', reply: `Resilience score ${r.score}/100 (SIMULATED on clones of the twin). The plan survives ${r.scenarios.filter((s) => s.survived).length} of ${r.scenarios.length} scenarios unchanged and ${r.scenarios.filter((s) => s.survived || s.recoveredByReoptimization).length} with re-optimization. Worst case: ${worst.scenario}, ${f1(worst.delayMin)} min of delay.`, resilience: r };
  },
  'analysis.regret': async () => {
    if (!ready()) return NEED_PLAN; const g = regret(twin, { maxIterations: 30 });
    const w = g.scenarios.slice().sort((a, b) => b.regretPct - a.regretPct)[0];
    return { grounded: true, label: 'SIMULATED', reply: w && w.regretFitness > 0 ? `Worst-case regret is ${f1(w.regretPct)}% of fitness under ${w.scenario} (${f1(w.regretMin)} operational minutes) against ${w.bestAlternative}. Average regret ${f1(g.meanRegretPct)}%.` : 'Zero regret across the tested scenarios: no alternative plan beats the current one in hindsight.', regret: g };
  },
  'analysis.time_windows': async () => {
    const p = ready(); if (!p) return NEED_PLAN; const r = timeWindowReport(p); const risky = r.stops.filter((s) => s.status !== 'SAFE').sort((a, b) => b.risk - a.risk);
    return { grounded: true, label: 'PREDICTED', reply: `Time windows (PREDICTED from the plan's schedule): ${r.counts.SAFE} safe, ${r.counts['AT RISK']} at risk, ${r.counts['LIKELY VIOLATION']} likely violations, ${r.counts.VIOLATED} violated.${risky.length ? ` Most exposed: ${risky.slice(0, 3).map((s) => `${s.deliveryId} (${s.label}, ${f1(s.slackMin)} min slack)`).join(', ')}.` : ''}`, report: r };
  },
  'analysis.counterfactual': async (p) => {
    if (!ready()) return NEED_PLAN;
    const last = twin.lastReoptimization;
    if (last && !p.eventType) { const cf = last.counterfactual; return { grounded: true, label: 'SIMULATED', reply: `After the last disruption, WITHOUT re-optimization the old plan takes ${f1(cf.withoutReoptimization.totalTimeMin)} min with ${cf.withoutReoptimization.unassigned} unserved; WITH it ${f1(cf.withReoptimization.totalTimeMin)} min with ${cf.withReoptimization.unassigned} unserved. Delay avoided: ${f1(cf.delayAvoidedMin)} min.`, counterfactual: cf }; }
    const req = eventFromParams({ ...p, eventType: p.eventType ?? 'ACCIDENT' }); if ('error' in req) return { ...req, reply: req.error };
    const o = simulateScenario(twin, { name: 'COUNTERFACTUAL', requests: [req] }, { maxIterations: 40 });
    return { grounded: true, label: 'SIMULATED', reply: `${o.description} WITHOUT re-optimization: ${f1(o.withoutReoptimization.totalTimeMin)} min, ${o.withoutReoptimization.unassigned} unserved. WITH: ${f1(o.withReoptimization.totalTimeMin)} min, ${o.withReoptimization.unassigned} unserved. Delay avoided ${f1(o.counterfactual.delayAvoidedMin)} min.`, counterfactual: o.counterfactual };
  },
  'fleet.why_reassigned': async (p) => {
    const re = twin.lastReoptimization; if (!re) return { grounded: true, reply: 'No re-optimization has happened yet, so nothing has been reassigned.', reassigned: [] };
    const list = p.vehicleId ? re.diff.reassigned.filter((r) => r.from === p.vehicleId || r.to === p.vehicleId) : re.diff.reassigned;
    return { grounded: true, reply: `${list.length ? `${list.map((r) => `${r.deliveryId} moved ${r.from ?? 'unassigned'} → ${r.to ?? 'unserved'}`).slice(0, 8).join('; ')}. ` : 'No matching deliveries were reassigned. '}Reason: ${re.explanation[0]}`, reassigned: list, explanation: re.explanation };
  },
  'benchmark.compare': async (p) => {
    let rep = getLastBenchmark(); let ranNow = false;
    if (!rep) {
      const g = getGraph(); const ds = generateDataset(26137, 8, 3, g, 'pune-hub', { startTimeMin: 540, capacityHeadroom: 1.4 });
      rep = runBenchmark({ graph: g.clone(), depotId: 'pune-hub', customers: ds.customers, fleet: ds.fleet, weights: DEFAULT_WEIGHTS, weather: { rainMm: 0, weatherSeverity: 0 }, populationSize: 30, maxIterations: 50, startTimeMin: 540 }, { datasetLabel: 'FRIDAY quick benchmark (8 customers, 3 vehicles)' });
      setLastBenchmarkIfEmpty(rep); ranNow = true;
    }
    const [a, b] = (p.algorithms as string[] | undefined)?.length ? (p.algorithms as string[]) : ['AQPSO', 'QPSO'];
    const A = rep.results[a], B = rep.results[b ?? 'QPSO'];
    if (!A || !B) return { grounded: true, reply: `The latest benchmark did not include both ${a} and ${b}. It covered: ${Object.keys(rep.results).join(', ')}.` };
    const better = A.meanFitness < B.meanFitness ? a : b; const diffPct = Math.abs(A.meanFitness - B.meanFitness) / Math.max(A.meanFitness, B.meanFitness) * 100;
    const stat = a === 'QPSO' ? B.vsQPSO : b === 'QPSO' ? A.vsQPSO : undefined;
    return { grounded: true, label: 'MEASURED', reply: `${ranNow ? 'I ran a quick benchmark just now. ' : ''}Mean fitness over ${rep.meta.seeds.length} seeds (${rep.meta.seeds.join(', ')}): ${a} ${f1(A.meanFitness)} vs ${b} ${f1(B.meanFitness)} — ${better} is lower by ${f1(diffPct)}%. ${stat ? `Mann-Whitney p = ${stat.pValue.toFixed(3)}: ${stat.verdict}.` : 'Significance is reported against QPSO only.'} Lower is better; small gaps on one instance are not proof of general superiority.`, comparison: { a: A, b: B, seeds: rep.meta.seeds, dataset: rep.meta.datasetLabel } };
  },
  'benchmark.explain': async () => {
    const rep = getLastBenchmark(); if (!rep) return { grounded: true, reply: 'No benchmark has been run yet. Open Benchmarking and run one, or ask me to compare two algorithms.' };
    const m = rep.meta;
    return { grounded: true, label: 'MEASURED', reply: `Benchmark ${m.id} on ${m.datasetLabel}: ${m.algorithmsRun.join(', ')} with seeds ${m.seeds.join('/')}, population ${m.populationSize}, ${m.maxIterations} iterations, equal budget of ${m.evaluationBudget} evaluations each. Ranking by mean fitness: ${rep.ranking.map((r) => `${r.algorithm} ${f1(r.meanFitness)}`).join(', ')}. Hardware: ${m.hardware.cpu}, ${m.hardware.cores} cores. ${m.algorithmsSkipped.length ? m.algorithmsSkipped.map((s) => `${s.algorithm}: ${s.reason}`).join(' ') : ''}`, meta: m, ranking: rep.ranking };
  },
  'scalability.explain': async () => ({
    grounded: true,
    reply: 'The scalability test runs the optimizer for real at 10, 25, 50, 100, 250 and 500 deliveries and reports measured runtime, evaluations and memory. When the runtime extrapolated from smaller sizes exceeds the per-run limit, that size is reported as NOT EXECUTED instead of being estimated. The exact solver is never run beyond nine deliveries because permutations grow factorially.',
    action: { type: 'NAVIGATE', page: 'scalability' },
  }),
  'learning.summary': async () => {
    const s = summarize(); const c = etaCorrection();
    if (s.status === 'NO_DATA') return { grounded: true, reply: 'No actual-versus-predicted observations exist yet. They accumulate when a plan is executed or when vehicles report measured ETAs.', summary: s };
    const o = (s as any).overall;
    return { grounded: true, reply: `${s.message} Mean absolute ETA error ${f1(o.maeMin)} min, bias ${o.biasMin >= 0 ? '+' : ''}${f1(o.biasMin)} min (${(s as any).sources.measured} measured, ${(s as any).sources.simulatedExecution} simulated-execution). ${c.available ? `Learned correction factor ×${c.factor} (advisory).` : c.reason}`, summary: s, correction: c };
  },
  'demo.control': async (p) => {
    const a = p.demoAction ?? 'status';
    if (a === 'start') { await demo.start({ delayMs: 2500 }); return { grounded: true, reply: 'Starting the SIH demo — 21 steps, each executed against the real digital twin. Opening the demo page.', action: { type: 'NAVIGATE', page: 'sih-demo' } }; }
    if (a === 'pause') { demo.pause(); return { grounded: true, reply: 'Demo paused.', action: { type: 'NAVIGATE', page: 'sih-demo' } }; }
    if (a === 'resume') { demo.resume(); return { grounded: true, reply: 'Resuming the demo.', action: { type: 'NAVIGATE', page: 'sih-demo' } }; }
    if (a === 'reset') { demo.reset(); return { grounded: true, reply: 'Demo reset. The digital twin has been reloaded.' }; }
    const s = demo.state(); return { grounded: true, reply: `Demo is ${s.status}: step ${s.current} of ${s.total}${s.current ? ` (${s.steps[s.current - 1].title})` : ''}.`, state: { status: s.status, current: s.current } };
  },
  'algorithm.explain': async (p) => {
    const asked = ((p.algorithms as string[] | undefined) ?? []); const text = asked.length ? asked.map((a) => ALGO_TEXT[a]).filter(Boolean).join(' ') : (/objective|fitness/.test(String(p.raw ?? '')) ? ALGO_TEXT.OBJECTIVE : ALGO_TEXT.QPSO);
    return { grounded: true, reply: `${text} ${/quantum/i.test(String(p.raw ?? '')) ? 'To be explicit: nothing in QUANTARA runs on quantum hardware.' : ''}`.trim() };
  },
  'system.self_check': async () => {
    const { runSelfChecks } = await import('../services/selfCheck'); const r = await runSelfChecks();
    return { grounded: true, reply: `Self-check ${r.overall}: ${r.checks.filter((c) => c.status === 'PASS').length} passed, ${r.checks.filter((c) => c.status === 'WARN').length} warnings, ${r.checks.filter((c) => c.status === 'FAIL').length} failed.${r.checks.filter((c) => c.status !== 'PASS').slice(0, 3).map((c) => ` ${c.name}: ${c.detail}`).join('')}`, checks: r.checks };
  },
};

export const TWIN_ADMIN_TOOLS = ['twin.optimize', 'twin.what_if', 'twin.apply_event', 'twin.reoptimize', 'analysis.resilience', 'analysis.regret', 'analysis.counterfactual', 'demo.control', 'system.self_check'];
export const TWIN_WRITE_TOOLS = ['twin.apply_event'];
