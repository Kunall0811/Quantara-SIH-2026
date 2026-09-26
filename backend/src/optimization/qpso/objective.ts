import { RouteOracle } from '../routeOracle';
import { evaluateVrpPosition, evaluatePosition } from '../waypointOrder';
import { validateVrpSolution } from '../constraints';
import { VrpEvaluation, RouteEvaluation } from '../fitness';
import { RunParams, OptimizerResult, IterationRecord, AdaptiveTrace } from './types';
import { mulberry32 } from '../rng';

export type AnyEval = VrpEvaluation | RouteEvaluation;

export interface Objective {
  dimension: number;
  isVrp: boolean;
  oracle: RouteOracle;
  evaluate(position: number[]): { fitness: number; eval: AnyEval; feasible: boolean };
  readonly evaluations: number;
}

/**
 * THE objective function every optimizer, the benchmark engine, the scenario
 * engine and the digital twin share. It wraps decoding + evaluation + hard
 * constraint validation and counts evaluations (for fair budgets).
 */
export function createObjective(p: RunParams): Objective {
  const oracle = p.oracle ?? new RouteOracle(p.graph);
  const isVrp = !!(p.customers && p.fleet && p.depotId);
  const dimension = isVrp ? p.customers!.length : (p.waypointIds ? p.waypointIds.length : 0);
  let evaluations = 0;
  return {
    dimension, isVrp, oracle,
    get evaluations() { return evaluations; },
    evaluate(position: number[]) {
      evaluations++;
      if (isVrp) {
        const vrp = evaluateVrpPosition(position, p.graph, p.depotId!, p.customers!, p.fleet!, p.weights, p.weather, p.algo || 'dijkstra', p.startTimeMin ?? 0, oracle);
        const v = validateVrpSolution(vrp, p.customers!, p.fleet!, p.depotId!, p.graph);
        return { fitness: vrp.fitness, eval: vrp, feasible: v.feasible };
      }
      const ev = evaluatePosition(position, p.graph, p.originId!, p.destinationId!, p.waypointIds!, p.weights, p.vehicle!, p.weather, p.algo || 'dijkstra', oracle);
      return { fitness: ev.fitness, eval: ev, feasible: ev.unreachableSegments === 0 };
    },
  };
}

export function extractOrder(e: AnyEval | undefined): string[] {
  if (!e) return [];
  if ('order' in e && Array.isArray((e as any).order)) return (e as any).order as string[];
  if ('routes' in e) {
    const out: string[] = [];
    for (const r of (e as VrpEvaluation).routes) out.push(...r.order.slice(1, r.order.length - 1));
    return out;
  }
  return [];
}

export function violationsOf(e: AnyEval | undefined) {
  if (!e) return [];
  if ('constraintViolations' in e && (e as VrpEvaluation).constraintViolations) return (e as VrpEvaluation).constraintViolations!;
  if ((e as RouteEvaluation).unreachableSegments > 0) return [{ code: 'C9', message: `${(e as RouteEvaluation).unreachableSegments} unreachable segment(s).` }];
  return [];
}

export function opRng(seed: number, salt: number) {
  return mulberry32(Math.imul(seed | 0, 2654435761) + salt);
}

/** mean absolute deviation of the swarm around its centroid (uniform[0,1]² swarm ≈ 0.25). */
export function swarmDiversity(pos: number[][]): number {
  const N = pos.length; if (!N) return 0;
  const n = pos[0].length; if (!n) return 0;
  let total = 0;
  for (let d = 0; d < n; d++) {
    let mean = 0; for (let i = 0; i < N; i++) mean += pos[i][d]; mean /= N;
    for (let i = 0; i < N; i++) total += Math.abs(pos[i][d] - mean);
  }
  return total / (N * n);
}

export function budgetIterations(p: RunParams, N: number, fallback: number): number {
  let it = p.maxIterations ?? fallback;
  const cap = p.stoppingCriteria?.maxEvaluations;
  if (cap && cap > 0) it = Math.min(it, Math.max(1, Math.floor(cap / N)));
  return Math.max(1, it);
}

export interface FinalizeArgs {
  algorithm: string; p: RunParams; obj: Objective; t0: number;
  bestPos: number[]; bestFit: number; bestEval: AnyEval | undefined;
  convergence: number[]; evalHist: number[]; iterationHistory: IterationRecord[];
  parameters: Record<string, number | string | boolean>;
  stoppedBy: OptimizerResult['stoppedBy'];
  adaptive?: AdaptiveTrace;
}

export function finalize(a: FinalizeArgs): OptimizerResult {
  const runtimeSeconds = (performance.now() - a.t0) / 1000;
  const violations = violationsOf(a.bestEval);
  const feasible = a.bestEval && 'feasible' in a.bestEval && (a.bestEval as VrpEvaluation).feasible !== undefined
    ? !!(a.bestEval as VrpEvaluation).feasible
    : violations.length === 0;
  return {
    algorithm: a.algorithm, seed: a.p.seed ?? 42, parameters: a.parameters,
    bestSolution: a.bestPos, bestOrder: extractOrder(a.bestEval), bestFitness: a.bestFit, bestEval: a.bestEval!,
    convergence: a.convergence, convergenceHistory: a.convergence, evaluationsHistory: a.evalHist,
    iterationHistory: a.iterationHistory, runtimeSeconds, runtime: runtimeSeconds,
    iterations: a.convergence.length, evaluations: a.obj.evaluations,
    feasible, feasibility: feasible, constraintViolations: violations, adaptive: a.adaptive, stoppedBy: a.stoppedBy,
  };
}

/** Result for a problem with no decision variables (0 or 1 stop). */
export function trivialResult(algorithm: string, p: RunParams, obj: Objective, t0: number, parameters: Record<string, number | string | boolean>): OptimizerResult {
  const r = obj.evaluate([]);
  return finalize({
    algorithm, p, obj, t0, bestPos: [], bestFit: r.fitness, bestEval: r.eval,
    convergence: [r.fitness], evalHist: [obj.evaluations],
    iterationHistory: [{ iteration: 1, evaluations: obj.evaluations, bestFitness: r.fitness, meanFitness: r.fitness, diversity: 0 }],
    parameters, stoppedBy: 'TRIVIAL',
  });
}
