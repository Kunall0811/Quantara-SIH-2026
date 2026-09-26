/**
 * Exhaustive solver over the SAME decoded search space the metaheuristics use
 * (every permutation of the customer / waypoint sequence → giant-tour decoder → evaluation).
 * It is therefore exactly optimal *within that space*, which makes an
 * "optimality gap" for QPSO/PSO/GA/SA meaningful; it is NOT a proof of global VRP
 * optimality (the decoder's fleet split is greedy). Limited to n ≤ EXACT_MAX_CUSTOMERS.
 */
import { Customer, FitnessWeights, VehicleProfileLite, WeatherContext } from './fitness';
import { RoadGraph } from './graph';
import { RunParams, OptimizerResult, IterationRecord } from './qpso/types';
import { createObjective, finalize, AnyEval } from './qpso/objective';

export const EXACT_MAX_CUSTOMERS = 9;

function* permute(arr: number[]): Generator<number[]> {
  const length = arr.length; const c = Array(length).fill(0); let i = 1;
  yield arr.slice();
  while (i < length) {
    if (c[i] < i) {
      const k = i % 2 && c[i]; const t = arr[i]; arr[i] = arr[k]; arr[k] = t; ++c[i]; i = 1; yield arr.slice();
    } else { c[i] = 0; ++i; }
  }
}

export function runExact(p: RunParams): OptimizerResult {
  const t0 = performance.now();
  const obj = createObjective(p); const n = obj.dimension;
  if (n > EXACT_MAX_CUSTOMERS) throw new Error(`Exact solver is limited to small instances (N <= ${EXACT_MAX_CUSTOMERS}); got N=${n}.`);
  const total = Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b, 1) || 1;
  const checkpoint = Math.max(1, Math.floor(total / 100));
  const maxMs = p.stoppingCriteria?.maxRuntimeMs ?? 60_000;
  const parameters = { dimension: n, permutations: total, complete: true as boolean };

  if (n === 0) { const r = obj.evaluate([]); return finalize({ algorithm: 'EXACT', p, obj, t0, bestPos: [], bestFit: r.fitness, bestEval: r.eval, convergence: [r.fitness], evalHist: [1], iterationHistory: [], parameters, stoppedBy: 'EXACT_COMPLETE' }); }

  let bestFit = Infinity; let bestEval: AnyEval | undefined; let bestPos: number[] = [];
  const convergence: number[] = [], evalHist: number[] = [], history: IterationRecord[] = [];
  let stoppedBy: OptimizerResult['stoppedBy'] = 'EXACT_COMPLETE';
  let count = 0;
  for (const perm of permute(Array.from({ length: n }, (_, i) => i))) {
    const position = new Array(n).fill(0);
    for (let i = 0; i < n; i++) position[perm[i]] = i / n;  // argsort(position) reproduces `perm`
    const r = obj.evaluate(position);
    if (r.fitness < bestFit) { bestFit = r.fitness; bestEval = r.eval; bestPos = position; }
    count++;
    if (count % checkpoint === 0 || count === total) {
      convergence.push(bestFit); evalHist.push(obj.evaluations);
      history.push({ iteration: convergence.length, evaluations: obj.evaluations, bestFitness: bestFit, meanFitness: r.fitness, diversity: 0 });
    }
    if ((count & 1023) === 0 && performance.now() - t0 > maxMs) { stoppedBy = 'RUNTIME'; parameters.complete = false; break; }
  }
  if (!bestEval) throw new Error('Exact solver failed to find any solution.');
  return finalize({ algorithm: 'EXACT', p, obj, t0, bestPos, bestFit, bestEval, convergence, evalHist, iterationHistory: history, parameters, stoppedBy });
}

/** Backwards-compatible wrapper (legacy signature). */
export function runExactSolver(
  graph: RoadGraph, depotId: string, customers: Customer[], fleet: VehicleProfileLite[],
  weights: FitnessWeights, weather: WeatherContext, algo: 'dijkstra' | 'astar' = 'dijkstra',
): OptimizerResult {
  return runExact({ graph, depotId, customers, fleet, weights, weather, algo });
}
