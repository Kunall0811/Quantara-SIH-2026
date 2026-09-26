/**
 * Scenario, Resilience, Regret, Counterfactual, Time-window risk, Explainability, Route DNA —
 * all computed by ACTUALLY re-simulating the network and re-running the optimizer on a CLONE of the
 * live twin. No hard-coded speed/traffic multipliers, no numbers supplied by the UI.
 */
import { RoadGraph } from '../optimization/graph';
import { VehicleProfileLite, VrpEvaluation, WeatherContext } from '../optimization/fitness';
import { runAlgorithm } from '../optimization';
import { evaluateFixedPlan } from '../optimization/waypointOrder';
import { RouteOracle } from '../optimization/routeOracle';
import { WEATHER_MODEL } from '../services/graphService';
import { TwinEngine } from './engine';
import { EventRequest, Plan, PlanTotals, specOf } from './types';
import { mutateNetwork, applyWeatherToClone } from './mutate';
import { buildPlan, planTotals } from './plan';
import { diffPlans, effectiveDelayMin, PlanDiff } from './diff';
import { baseId } from './roadCodes';

// ── SLA thresholds used to call a scenario "survived" (documented in docs/RESILIENCE.md) ──
export const SURVIVE_MAX_EXTRA_LATENESS_MIN = 15;
export const SURVIVE_MAX_EXTRA_TIME_PCT = 25;

export interface ScenarioSpec { name: string; requests: EventRequest[] }
export interface CostView extends PlanTotals { fitness: number; unassigned: number; effectiveDelayMin: number; operationalCostMin: number }

const costOf = (ev: { totals: PlanTotals; unassigned: number; fitness: number }): CostView => {
  const eff = effectiveDelayMin(ev.totals, ev.unassigned);
  return { ...ev.totals, fitness: ev.fitness, unassigned: ev.unassigned, effectiveDelayMin: eff, operationalCostMin: ev.totals.totalTimeMin + eff };
};
const viewOf = (ev: VrpEvaluation): CostView => costOf({ totals: planTotals(ev.routes), unassigned: ev.unassigned.length, fitness: ev.fitness });

interface World { graph: RoadGraph; profiles: VehicleProfileLite[]; weather: WeatherContext; weatherName?: string; descriptions: string[]; affectedEdges: string[]; failedVehicles: string[] }

/** Build an isolated "what-if" world from the live twin and apply the requests to the CLONE. */
export function buildWorld(twin: TwinEngine, requests: EventRequest[], basis: Plan): World {
  const graph = twin.graph.clone();
  const profiles = twin.profiles().map((p) => ({ ...p }));
  let weather = twin.weather(); let weatherName: string | undefined;
  const descriptions: string[] = []; const affectedEdges: string[] = []; const failedVehicles: string[] = [];
  const use = new Map<string, number>();
  basis.routes.forEach((r) => r.edgePath.forEach((e) => use.set(baseId(e), (use.get(baseId(e)) ?? 0) + 1)));
  const busiestEdge = [...use.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  for (const req of requests) {
    if (req.type === 'ROAD_CLOSURE' || req.type === 'ACCIDENT' || req.type === 'TRAFFIC_INCREASE') {
      const m = mutateNetwork(graph, req, busiestEdge); descriptions.push(m.description); affectedEdges.push(...m.edges);
    } else if (req.type === 'WEATHER_CHANGE') {
      const c = req.condition ?? 'Heavy Rain'; const m = applyWeatherToClone(graph, c); weatherName = c;
      weather = { rainMm: m.rainMmPerH, weatherSeverity: m.severity }; descriptions.push(`Weather → ${c}: speed ×${m.speed}, congestion +${Math.round(m.congestionAdd * 100)}%.`);
    } else {
      const vid = req.vehicleId ?? basis.routes.slice().sort((a, b) => b.stops.length - a.stops.length || a.vehicleId.localeCompare(b.vehicleId))[0]?.vehicleId;
      const p = profiles.find((x) => x.id === vid); if (!p) throw new Error(`Unknown vehicle: ${vid}`);
      if (profiles.filter((x) => x.available !== false).length <= 1) throw new Error('Cannot disable the last available vehicle.');
      p.available = false; failedVehicles.push(p.id!); descriptions.push(`Vehicle ${p.id} ${req.type === 'VEHICLE_BREAKDOWN' ? 'breaks down' : 'becomes unavailable'}.`);
    }
  }
  return { graph, profiles, weather, weatherName, descriptions, affectedEdges, failedVehicles };
}

export interface ScenarioOutcome {
  name: string; requests: EventRequest[]; description: string; label: 'SIMULATED';
  baseline: CostView; withoutReoptimization: CostView; withReoptimization: CostView; reoptimizedPlan: Plan;
  diff: PlanDiff; affectedVehicles: string[]; affectedDeliveries: string[];
  counterfactual: { delayAvoidedMin: number; timeSavedMin: number; fuelSavedInr: number; co2SavedKg: number; deliveriesRecovered: number; distanceDeltaKm: number };
  survivedWithoutReopt: boolean; survivedWithReopt: boolean; extraTimePctWithoutReopt: number;
  method: string;
}

export interface SimOptions { algorithm?: string; populationSize?: number; maxIterations?: number; seed?: number; planId?: string }

export function simulateScenario(twin: TwinEngine, spec: ScenarioSpec, o: SimOptions = {}): ScenarioOutcome {
  twin.ensureLoaded();
  const plan = (o.planId ? twin.getPlan(o.planId) : twin.currentPlan);
  if (!plan) throw new Error('No plan to analyse. Run an optimization first.');
  const w = buildWorld(twin, spec.requests, plan);
  const customers = twin.customers();
  const orc = new RouteOracle(w.graph);
  const fixedSpec: Record<string, string[]> = {}; specOf(plan).routes.forEach((r) => { fixedSpec[r.vehicleId] = r.deliveryIds; });
  const stale = evaluateFixedPlan(fixedSpec, w.graph, twin.depotId, customers, w.profiles, twin.weights, w.weather, 'dijkstra', twin.startTimeMin, orc);
  const result = runAlgorithm(o.algorithm ?? 'AQPSO', {
    graph: w.graph, depotId: twin.depotId, customers, fleet: w.profiles, weights: twin.weights, weather: w.weather,
    populationSize: o.populationSize ?? 30, maxIterations: o.maxIterations ?? 60, seed: o.seed ?? twin.seed, startTimeMin: twin.startTimeMin, oracle: orc,
  });
  const reopt = buildPlan({ result, graph: w.graph, deliveries: twin.deliveries, fleet: twin.fleet, customers, profiles: w.profiles, depotId: twin.depotId, weights: twin.weights, startTimeMin: twin.startTimeMin, datasetLabel: twin.datasetLabel, twinVersion: twin.version, scenario: spec.name, steps: false });
  const base = costOf({ totals: plan.totals, unassigned: plan.unassigned.length, fitness: plan.fitness });
  const ws = viewOf(stale), wr = costOf({ totals: reopt.totals, unassigned: reopt.unassigned.length, fitness: reopt.fitness });
  const diff = diffPlans(plan, reopt);
  const hit = new Set(w.affectedEdges); const av = new Set<string>(w.failedVehicles); const ad = new Set<string>();
  for (const r of plan.routes) {
    const b = plan.routes.find((x) => x.vehicleId === r.vehicleId)!; const a = stale.routes.find((x) => x.vehicleId === r.vehicleId);
    const crosses = r.edgePath.some((e) => hit.has(e)); const slower = (a?.totalTimeMin ?? 0) - b.totalTimeMin > 1; const later = (a?.latenessMin ?? 0) - b.latenessMin > 0.5;
    if (w.failedVehicles.includes(r.vehicleId)) r.stops.forEach((s) => ad.add(s.deliveryId));
    else if (crosses || slower || later) { av.add(r.vehicleId); r.stops.forEach((s) => { if (crosses || (a?.stopDetails ?? []).some((d) => d.customerId === s.deliveryId && d.lateness > 0)) ad.add(s.deliveryId); }); }
  }
  stale.unassigned.forEach((id) => ad.add(id));
  const extraTimePct = base.totalTimeMin > 0 ? (ws.totalTimeMin - base.totalTimeMin) / base.totalTimeMin * 100 : 0;
  const ok = (v: CostView) => v.unassigned <= base.unassigned && (v.latenessMin - base.latenessMin) <= SURVIVE_MAX_EXTRA_LATENESS_MIN && ((v.totalTimeMin - base.totalTimeMin) / Math.max(1, base.totalTimeMin) * 100) <= SURVIVE_MAX_EXTRA_TIME_PCT;
  return {
    name: spec.name, requests: spec.requests, description: w.descriptions.join(' ') || 'No change (baseline).', label: 'SIMULATED',
    baseline: base, withoutReoptimization: ws, withReoptimization: wr, reoptimizedPlan: reopt, diff,
    affectedVehicles: [...av], affectedDeliveries: [...ad],
    counterfactual: {
      delayAvoidedMin: ws.effectiveDelayMin - wr.effectiveDelayMin, timeSavedMin: ws.totalTimeMin - wr.totalTimeMin, fuelSavedInr: ws.fuelCostInr - wr.fuelCostInr,
      co2SavedKg: ws.co2Kg - wr.co2Kg, deliveriesRecovered: ws.unassigned - wr.unassigned, distanceDeltaKm: wr.distanceKm - ws.distanceKm,
    },
    survivedWithoutReopt: ok(ws), survivedWithReopt: ok(wr), extraTimePctWithoutReopt: extraTimePct,
    method: `Cloned live twin → applied ${spec.requests.length} event(s) → re-simulated the committed plan on the changed network (no re-assignment) → re-ran ${o.algorithm ?? 'AQPSO'} (N=${o.populationSize ?? 30}, ${o.maxIterations ?? 60} iterations, seed ${o.seed ?? twin.seed}) on the same clone.`,
  };
}

/** Standard scenario battery — closure/accident on the plan's busiest road, network traffic, rain, breakdown. */
export function standardScenarios(): ScenarioSpec[] {
  return [
    { name: 'NORMAL', requests: [] },
    { name: 'ACCIDENT', requests: [{ type: 'ACCIDENT', scope: 'ROAD' }] },
    { name: 'ROAD_CLOSURE', requests: [{ type: 'ROAD_CLOSURE', scope: 'ROAD' }] },
    { name: 'HEAVY_TRAFFIC', requests: [{ type: 'TRAFFIC_INCREASE', percent: 50, scope: 'MAJOR' }] },
    { name: 'RAIN', requests: [{ type: 'WEATHER_CHANGE', condition: 'Heavy Rain' }] },
    { name: 'VEHICLE_FAILURE', requests: [{ type: 'VEHICLE_BREAKDOWN' }] },
  ];
}

export function resilience(twin: TwinEngine, o: SimOptions & { scenarios?: ScenarioSpec[] } = {}) {
  const specs = o.scenarios ?? standardScenarios();
  const outcomes = specs.map((s) => simulateScenario(twin, s, o));
  const value = (x: ScenarioOutcome) => (x.survivedWithoutReopt ? 1 : x.survivedWithReopt ? 0.5 : 0);
  const score = outcomes.length ? outcomes.reduce((s, x) => s + value(x), 0) / outcomes.length * 100 : 100;
  const disturbed = outcomes.filter((x) => x.name !== 'NORMAL');
  return {
    label: 'SIMULATED' as const, score: Number(score.toFixed(1)),
    successRate: outcomes.length ? outcomes.filter((x) => x.survivedWithoutReopt).length / outcomes.length : 1,
    recoverableRate: outcomes.length ? outcomes.filter((x) => x.survivedWithReopt).length / outcomes.length : 1,
    expectedDelayMin: disturbed.length ? disturbed.reduce((s, x) => s + (x.withoutReoptimization.effectiveDelayMin - x.baseline.effectiveDelayMin), 0) / disturbed.length : 0,
    worstCaseDelayMin: disturbed.reduce((m, x) => Math.max(m, x.withoutReoptimization.effectiveDelayMin - x.baseline.effectiveDelayMin), 0),
    scenarios: outcomes.map((x) => ({
      scenario: x.name, description: x.description, survived: x.survivedWithoutReopt, recoveredByReoptimization: x.survivedWithReopt,
      baselineTimeMin: x.baseline.totalTimeMin, timeMin: x.withoutReoptimization.totalTimeMin, delayMin: x.withoutReoptimization.effectiveDelayMin - x.baseline.effectiveDelayMin,
      extraTimePct: x.extraTimePctWithoutReopt, missedDeliveries: x.withoutReoptimization.unassigned, lateStops: x.withoutReoptimization.lateStops,
      affectedVehicles: x.affectedVehicles, affectedDeliveries: x.affectedDeliveries,
      afterReoptimization: { timeMin: x.withReoptimization.totalTimeMin, delayMin: x.withReoptimization.effectiveDelayMin - x.baseline.effectiveDelayMin, missedDeliveries: x.withReoptimization.unassigned },
    })),
    methodology: `Each scenario is simulated on a clone of the live twin. "Survived" = the committed plan, re-simulated unchanged, misses no extra deliveries, adds ≤ ${SURVIVE_MAX_EXTRA_LATENESS_MIN} min lateness and ≤ ${SURVIVE_MAX_EXTRA_TIME_PCT}% total time. Score = mean(1 if survived; 0.5 if only re-optimization restores it; 0 otherwise) × 100.`,
  };
}

/** Regret: how much worse is the committed plan than the best plan we could have picked *knowing the scenario*? */
export function regret(twin: TwinEngine, o: SimOptions & { scenarios?: ScenarioSpec[] } = {}) {
  twin.ensureLoaded();
  const plan = o.planId ? twin.getPlan(o.planId) : twin.currentPlan; if (!plan) throw new Error('No plan to analyse.');
  const specs = (o.scenarios ?? standardScenarios()).filter((s) => s.name !== 'NORMAL');
  const alts = twin.plans.filter((p) => p.id !== plan.id && p.dataset.fingerprint === plan.dataset.fingerprint);
  const rows = specs.map((s) => {
    const out = simulateScenario(twin, s, o);
    const w = buildWorld(twin, s.requests, plan); const customers = twin.customers(); const orc = new RouteOracle(w.graph);
    const selected = out.withoutReoptimization;
    const cands: { label: string; cost: CostView }[] = alts.map((p) => {
      const sp: Record<string, string[]> = {}; specOf(p).routes.forEach((r) => { sp[r.vehicleId] = r.deliveryIds; });
      return { label: `${p.algorithm} ${p.id}`, cost: viewOf(evaluateFixedPlan(sp, w.graph, twin.depotId, customers, w.profiles, twin.weights, w.weather, 'dijkstra', twin.startTimeMin, orc)) };
    });
    cands.push({ label: `hindsight re-optimization (${o.algorithm ?? 'AQPSO'})`, cost: out.withReoptimization });
    const best = cands.reduce((b, c) => (c.cost.fitness < b.cost.fitness ? c : b));   // "best" = lowest value of the objective the optimizer minimises
    return {
      scenario: s.name, selectedFitness: selected.fitness, bestAlternative: best.label, bestAlternativeFitness: best.cost.fitness,
      regretFitness: Math.max(0, selected.fitness - best.cost.fitness), regretPct: selected.fitness > 0 ? Math.max(0, selected.fitness - best.cost.fitness) / selected.fitness * 100 : 0,
      selectedCostMin: selected.operationalCostMin, bestAlternativeCostMin: best.cost.operationalCostMin, regretMin: Math.max(0, selected.operationalCostMin - best.cost.operationalCostMin),
    };
  });
  return {
    label: 'SIMULATED' as const, planId: plan.id, scenarios: rows,
    maxRegretMin: rows.reduce((m, r) => Math.max(m, r.regretMin), 0),
    meanRegretMin: rows.length ? rows.reduce((s, r) => s + r.regretMin, 0) / rows.length : 0,
    maxRegretPct: rows.reduce((m, r) => Math.max(m, r.regretPct), 0),
    meanRegretPct: rows.length ? rows.reduce((s, r) => s + r.regretPct, 0) / rows.length : 0,
    definition: 'regret(s) = fitness(selected plan under s) − min over {other plans of this dataset, hindsight re-optimization under s} of fitness — i.e. measured in the objective the optimizer minimises. regretMin is the same comparison in operational minutes (route time + lateness + 60 min × missed deliveries), floored at 0.',
  };
}

// ── time-window risk from REAL stop timings ────────────────────────────────
export type TwStatus = 'SAFE' | 'AT RISK' | 'LIKELY VIOLATION' | 'VIOLATED';
export function stopRisk(s: { serviceStart: number; arrival: number; windowStart: number; windowEnd: number; lateness: number }) {
  if (s.windowEnd <= s.windowStart) return { status: 'VIOLATED' as TwStatus, slackMin: 0, risk: 1 };
  const slack = s.windowEnd - s.serviceStart;
  if (s.lateness > 0) return { status: 'VIOLATED' as TwStatus, slackMin: slack, risk: 1 };
  if (slack < 5) return { status: 'LIKELY VIOLATION' as TwStatus, slackMin: slack, risk: 0.85 };
  if (slack < 15) return { status: 'AT RISK' as TwStatus, slackMin: slack, risk: 0.5 };
  return { status: 'SAFE' as TwStatus, slackMin: slack, risk: 0.1 };
}
export function timeWindowReport(plan: Plan) {
  const stops = plan.routes.flatMap((r) => r.stops.map((s) => ({ vehicleId: r.vehicleId, deliveryId: s.deliveryId, label: s.label, arrival: s.arrival, serviceStart: s.serviceStart, waiting: s.waiting, windowStart: s.windowStart, windowEnd: s.windowEnd, lateness: s.lateness, ...stopRisk(s) })));
  const counts = { SAFE: 0, 'AT RISK': 0, 'LIKELY VIOLATION': 0, VIOLATED: 0 } as Record<TwStatus, number>;
  stops.forEach((s) => counts[s.status]++);
  return { planId: plan.id, label: 'PREDICTED' as const, counts, stops, unassigned: plan.unassigned };
}

// ── explainability & DNA from the exact objective decomposition ────────────
const TERM_LABEL: Record<string, string> = { distance: 'Distance', travelTime: 'Travel time', traffic: 'Traffic', fuelCost: 'Fuel cost', risk: 'Road risk', weather: 'Weather', turns: 'Turns', penalty: 'Constraint penalty' };
export function explainPlan(plan: Plan) {
  const t = plan.terms as unknown as Record<string, number>;
  const total = Object.values(t).reduce((s, v) => s + v, 0) || 1;
  const factors = Object.keys(TERM_LABEL).map((k) => ({
    factor: TERM_LABEL[k], key: k, weight: k === 'penalty' ? null : (plan.weights as unknown as Record<string, number>)[k], contribution: t[k], sharePct: Number((t[k] / total * 100).toFixed(2)),
  })).sort((a, b) => b.contribution - a.contribution);
  const top = factors.slice(0, 3).filter((f) => f.sharePct > 0);
  const sentences = [
    `Plan ${plan.dnaId} was produced by ${plan.algorithm} (seed ${plan.seed}, ${plan.evaluations} objective evaluations) and scores fitness ${plan.fitness.toFixed(2)} — lower is better.`,
    `The objective is dominated by ${top.map((f) => `${f.factor.toLowerCase()} (${f.sharePct}%)`).join(', ')}.`,
    plan.terms.penalty > 0 ? `Constraint penalty is ${plan.terms.penalty.toFixed(1)} because ${plan.unassigned.length ? `${plan.unassigned.length} delivery(ies) are unassigned` : ''}${plan.totals.lateStops ? `${plan.unassigned.length ? ' and ' : ''}${plan.totals.lateStops} stop(s) are late by ${plan.totals.latenessMin.toFixed(0)} min in total` : ''}.` : 'No constraint penalty: every delivery is served inside its window with capacity respected.',
    `Routes use ${plan.routes.length} of ${plan.dataset.vehicles} vehicles; total ${plan.totals.distanceKm.toFixed(1)} km, ${plan.totals.totalTimeMin.toFixed(0)} min, ₹${plan.totals.fuelCostInr.toFixed(0)}, ${plan.totals.co2Kg.toFixed(2)} kg CO₂.`,
  ];
  return { planId: plan.id, dnaId: plan.dnaId, factors, sentences, identity: exact(plan.terms, plan.fitness) };
}
const exact = (terms: object, fitness: number) => Math.abs(Object.values(terms).reduce((s: number, v: number) => s + v, 0) - fitness) < 1e-6;

export function routeDnaOf(plan: Plan, extra?: { resilience?: number; regretMin?: number }) {
  return {
    id: plan.dnaId, planId: plan.id, algorithm: plan.algorithm, seed: plan.seed, datasetFingerprint: plan.dataset.fingerprint, twinVersion: plan.twinVersion,
    fitness: plan.fitness, totals: plan.totals, weights: plan.weights, resilience: extra?.resilience ?? null, regretMin: extra?.regretMin ?? null,
    assignment: specOf(plan).routes, traceable: true,
  };
}

export { WEATHER_MODEL };

// ── congestion prediction (PREDICTED) ──────────────────────────────────────
/** Documented diurnal demand profile (multiplier on current congestion): morning peak 08–10, evening peak 17–20. */
export const DIURNAL_PROFILE: number[] = [0.4, 0.35, 0.3, 0.3, 0.35, 0.5, 0.75, 1.0, 1.3, 1.25, 1.05, 1.0, 1.05, 1.0, 0.95, 1.0, 1.15, 1.4, 1.45, 1.3, 1.0, 0.8, 0.6, 0.5];
export function predictCongestion(twin: TwinEngine, plan: Plan) {
  const g = twin.graph;
  return plan.routes.map((r) => {
    const cong = r.edgePath.length ? r.edgePath.reduce((s, e) => s + (g.edges.get(e)?.congestionPct ?? 0), 0) / r.edgePath.length : 0;
    const t0 = plan.dataset.startTimeMin, t1 = t0 + r.totalTimeMin;
    const hourly: { hour: number; predictedCongestionPct: number }[] = [];
    for (let h = Math.floor(t0 / 60); h <= Math.floor(t1 / 60); h++) hourly.push({ hour: h % 24, predictedCongestionPct: Number(Math.min(100, cong * 100 * DIURNAL_PROFILE[h % 24]).toFixed(1)) });
    const peak = hourly.reduce((m, x) => (x.predictedCongestionPct > m.predictedCongestionPct ? x : m), hourly[0]);
    return { vehicleId: r.vehicleId, currentCongestionPct: Number((cong * 100).toFixed(1)), hourly, peak, label: 'PREDICTED' as const };
  });
}
