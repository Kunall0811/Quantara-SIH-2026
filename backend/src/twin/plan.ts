/** Converts a raw OptimizerResult into a persisted, explainable, directions-bearing Plan. */
import crypto from 'crypto';
import { RoadGraph } from '../optimization/graph';
import { OptimizerResult } from '../optimization/qpso/types';
import { VrpEvaluation, FitnessWeights } from '../optimization/fitness';
import { datasetFingerprint } from '../optimization/datasetGenerator';
import { Customer, VehicleProfileLite } from '../optimization/fitness';
import { Delivery, OpsVehicle, Plan, PlanRoute, PlanTotals, PlanSpec } from './types';
import { buildSteps, graphGeometry } from './directions';

export function planTotals(routes: { distanceKm: number; durationMin: number; totalTimeMin: number; fuelCostInr: number; co2Kg: number; riskScore: number; latenessMin: number; lateStops: number }[]): PlanTotals {
  const sum = (f: (r: typeof routes[number]) => number) => routes.reduce((s, r) => s + f(r), 0);
  return {
    distanceKm: sum((r) => r.distanceKm), durationMin: sum((r) => r.durationMin), totalTimeMin: sum((r) => r.totalTimeMin),
    fuelCostInr: sum((r) => r.fuelCostInr), co2Kg: sum((r) => r.co2Kg),
    riskScore: routes.length ? sum((r) => r.riskScore) / routes.length : 0,
    latenessMin: sum((r) => r.latenessMin), lateStops: sum((r) => r.lateStops),
    makespanMin: routes.reduce((m, r) => Math.max(m, r.totalTimeMin), 0),
  };
}

export function planDnaId(algorithm: string, spec: PlanSpec, fingerprint: string, seed: number, weights: FitnessWeights, fitness: number): { id: string; fingerprint: string } {
  const canon = JSON.stringify({ algorithm, spec, fingerprint, seed, weights, fitness: Number(fitness.toFixed(6)) });
  const h = crypto.createHash('sha256').update(canon).digest('hex').toUpperCase();
  return { id: `${algorithm}-${h.slice(0, 4)}-${h.slice(4, 8)}`, fingerprint: h };
}

let planCounter = 0;
export function resetPlanCounter() { planCounter = 0; }

export interface BuildPlanArgs {
  result: OptimizerResult; graph: RoadGraph; deliveries: Delivery[]; fleet: OpsVehicle[]; customers: Customer[]; profiles: VehicleProfileLite[];
  depotId: string; weights: FitnessWeights; startTimeMin: number; datasetLabel: string; twinVersion: number; scenario: string;
  steps?: boolean;
}

export function buildPlan(a: BuildPlanArgs): Plan {
  const vrp = a.result.bestEval as VrpEvaluation;
  const dById = new Map(a.deliveries.map((d) => [d.id, d]));
  const capById = new Map(a.fleet.map((v) => [v.id, v.capacity]));
  const routes: PlanRoute[] = vrp.routes.map((r) => {
    const stopNodes = r.customerIds.map((id) => dById.get(id)?.nodeId ?? '');
    const stopLabels = r.customerIds.map((id) => dById.get(id)?.label ?? id);
    return {
      vehicleId: r.vehicleId, order: r.order, nodePath: r.nodePath, edgePath: r.edgePath,
      stops: r.stopDetails.map((s) => ({
        deliveryId: s.customerId!, label: dById.get(s.customerId!)?.label ?? s.customerId!, nodeId: s.nodeId,
        arrival: s.arrival, serviceStart: s.serviceStart, waiting: s.waiting, lateness: s.lateness, windowStart: s.windowStart, windowEnd: s.windowEnd,
      })),
      distanceKm: r.distanceKm, durationMin: r.durationMin, totalTimeMin: r.totalTimeMin, fuelCostInr: r.fuelCostInr, co2Kg: r.co2Kg, riskScore: r.riskScore,
      load: r.load, capacity: capById.get(r.vehicleId) ?? 0, latenessMin: r.latenessMin, lateStops: r.lateStops,
      geometry: graphGeometry(a.graph, r.nodePath), geometrySource: 'FALLBACK',
      steps: a.steps === false ? undefined : buildSteps(a.graph, r.nodePath, r.edgePath, stopNodes, stopLabels),
    };
  });
  const fp = datasetFingerprint(a.customers, a.profiles, a.depotId);
  const spec: PlanSpec = { routes: routes.map((r) => ({ vehicleId: r.vehicleId, deliveryIds: r.stops.map((s) => s.deliveryId) })) };
  const dna = planDnaId(a.result.algorithm as string, spec, fp, a.result.seed, a.weights, vrp.fitness);
  planCounter++;
  const ad = a.result.adaptive;
  return {
    id: `PLAN-${String(planCounter).padStart(3, '0')}-${dna.id.split('-')[1]}`,
    createdAt: new Date().toISOString(), algorithm: a.result.algorithm as string, seed: a.result.seed, parameters: a.result.parameters,
    dataset: { label: a.datasetLabel, fingerprint: fp, customers: a.customers.length, vehicles: a.profiles.length, depotId: a.depotId, startTimeMin: a.startTimeMin },
    weights: a.weights, fitness: vrp.fitness, terms: vrp.terms, totals: planTotals(routes),
    feasible: a.result.feasible, violations: a.result.constraintViolations, unassigned: vrp.unassigned,
    routes, convergence: a.result.convergence, evaluations: a.result.evaluations, iterations: a.result.iterations, runtimeSeconds: a.result.runtimeSeconds,
    adaptive: ad ? { betaHistory: ad.betaHistory, diversityHistory: ad.diversityHistory, explorationHistory: ad.explorationHistory, exploitationHistory: ad.exploitationHistory, stagnationHistory: ad.stagnationHistory, adaptiveHistory: ad.adaptiveHistory, restarts: ad.restarts } : undefined,
    dnaId: dna.id, twinVersion: a.twinVersion, scenario: a.scenario, source: 'SIMULATED',
  };
}
