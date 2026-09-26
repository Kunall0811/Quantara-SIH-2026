/**
 * Simulated Annealing baseline on the same random-key encoding.
 * Temperature is calibrated to the problem scale (T0 = 5 % of the initial
 * fitness, geometric cooling to T0/200) so it is a fair, tuned baseline rather
 * than a strawman. One objective evaluation per iteration, so "iterations" ==
 * evaluations; the benchmark gives SA the same total evaluation budget as the
 * population-based methods.
 */
import { RunParams, OptimizerResult, IterationRecord } from './qpso/types';
import { createObjective, trivialResult, finalize, opRng, budgetIterations, AnyEval } from './qpso/objective';
import { initialPopulation } from './rng';

export function runSA(p: RunParams): OptimizerResult {
  const t0 = performance.now();
  const obj = createObjective(p); const n = obj.dimension;
  const seed = p.seed ?? 42;
  // For SA the evaluation budget maps 1:1 onto iterations.
  const capEval = p.stoppingCriteria?.maxEvaluations;
  const maxIter = capEval ? Math.max(1, Math.floor(capEval)) : (p.maxIterations ?? 250);
  void budgetIterations;
  const parameters: Record<string, number | string | boolean> = { maxIterations: maxIter, dimension: n, cooling: 'geometric', neighbourhood: 'perturb ≈20% of keys' };
  if (n === 0) return trivialResult('SA', p, obj, t0, parameters);

  const rand = opRng(seed, 0x5a01);
  let current = initialPopulation(seed, 1, n)[0];
  let cur = obj.evaluate(current);
  let best = [...current]; let bestEval: AnyEval = cur.eval; let bestFit = cur.fitness;
  const T0 = Math.max(1, 0.05 * Math.abs(cur.fitness)); const Tend = T0 / 200;
  parameters.T0 = Number(T0.toFixed(4)); parameters.Tend = Number(Tend.toFixed(4));
  const cooling = Math.pow(Tend / T0, 1 / Math.max(1, maxIter));
  const convergence: number[] = [], evalHist: number[] = [], history: IterationRecord[] = [];
  let temp = T0; const crit = p.stoppingCriteria ?? {}; let stoppedBy: OptimizerResult['stoppedBy'] = 'MAX_ITERATIONS';
  const k = Math.max(1, Math.ceil(0.2 * n));

  for (let it = 0; it < maxIter; it++) {
    const cand = [...current];
    const step = 0.3 * (0.3 + 0.7 * (temp / T0));
    for (let j = 0; j < k; j++) { const d = Math.floor(rand() * n); cand[d] = Math.min(1, Math.max(0, cand[d] + (rand() - 0.5) * 2 * step)); }
    const ce = obj.evaluate(cand);
    const delta = ce.fitness - cur.fitness;
    if (delta < 0 || rand() < Math.exp(-delta / Math.max(temp, 1e-9))) {
      current = cand; cur = ce;
      if (cur.fitness < bestFit) { bestFit = cur.fitness; best = [...current]; bestEval = cur.eval; }
    }
    temp *= cooling;
    convergence.push(bestFit); evalHist.push(obj.evaluations);
    history.push({ iteration: it + 1, evaluations: obj.evaluations, bestFitness: bestFit, meanFitness: cur.fitness, diversity: 0 });
    p.onProgress?.(it + 1, maxIter, bestFit);
    if (crit.targetFitness !== undefined && bestFit <= crit.targetFitness) { stoppedBy = 'TARGET'; break; }
    if (crit.maxRuntimeMs !== undefined && performance.now() - t0 > crit.maxRuntimeMs) { stoppedBy = 'RUNTIME'; break; }
  }
  return finalize({ algorithm: 'SA', p, obj, t0, bestPos: best, bestFit, bestEval, convergence, evalHist, iterationHistory: history, parameters, stoppedBy });
}
