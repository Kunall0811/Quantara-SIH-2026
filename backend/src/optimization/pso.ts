/** Classical PSO baseline (inertia-weight form). Same objective, decoder and initial swarm as QPSO. */
import { RunParams, OptimizerResult, IterationRecord } from './qpso/types';
import { createObjective, trivialResult, finalize, opRng, swarmDiversity, budgetIterations, AnyEval } from './qpso/objective';
import { initialPopulation } from './rng';

export const PSO_DEFAULTS = { populationSize: 30, maxIterations: 100, w: 0.7, c1: 1.5, c2: 1.5, vmax: 0.3 };

export function runPSO(p: RunParams): OptimizerResult {
  const t0 = performance.now();
  const obj = createObjective(p); const n = obj.dimension;
  const N = p.populationSize ?? PSO_DEFAULTS.populationSize;
  const { w, c1, c2, vmax } = PSO_DEFAULTS;
  const seed = p.seed ?? 42;
  const maxIter = budgetIterations(p, N, PSO_DEFAULTS.maxIterations);
  const parameters = { populationSize: N, maxIterations: maxIter, inertia: w, c1, c2, vmax, dimension: n };
  if (n === 0) return trivialResult('PSO', p, obj, t0, parameters);

  const rand = opRng(seed, 0x9501);
  const positions = initialPopulation(seed, N, n);
  const velocities = Array.from({ length: N }, () => Array.from({ length: n }, () => (rand() - 0.5) * 0.2));
  const pbest = positions.map((x) => [...x]); const pbestFit: number[] = new Array(N).fill(Infinity);
  let gbest = [...positions[0]]; let gbestFit = Infinity; let gbestEval: AnyEval | undefined;
  const convergence: number[] = [], evalHist: number[] = [], history: IterationRecord[] = [];
  const crit = p.stoppingCriteria ?? {}; let stagnation = 0; let stoppedBy: OptimizerResult['stoppedBy'] = 'MAX_ITERATIONS';

  for (let it = 0; it < maxIter; it++) {
    let fitSum = 0; const prev = gbestFit;
    for (let i = 0; i < N; i++) {
      const r = obj.evaluate(positions[i]); fitSum += r.fitness;
      if (r.fitness < pbestFit[i]) { pbestFit[i] = r.fitness; pbest[i] = [...positions[i]]; }
      if (r.fitness < gbestFit) { gbestFit = r.fitness; gbest = [...positions[i]]; gbestEval = r.eval; }
    }
    convergence.push(gbestFit); evalHist.push(obj.evaluations);
    stagnation = gbestFit < prev - 1e-9 ? 0 : stagnation + 1;
    history.push({ iteration: it + 1, evaluations: obj.evaluations, bestFitness: gbestFit, meanFitness: fitSum / N, diversity: swarmDiversity(positions) });
    p.onProgress?.(it + 1, maxIter, gbestFit);
    if (crit.targetFitness !== undefined && gbestFit <= crit.targetFitness) { stoppedBy = 'TARGET'; break; }
    if (crit.stagnationLimit !== undefined && stagnation >= crit.stagnationLimit) { stoppedBy = 'STAGNATION'; break; }
    if (crit.maxRuntimeMs !== undefined && performance.now() - t0 > crit.maxRuntimeMs) { stoppedBy = 'RUNTIME'; break; }
    if (it === maxIter - 1) break;
    for (let i = 0; i < N; i++) for (let d = 0; d < n; d++) {
      const r1 = rand(), r2 = rand();
      let v = w * velocities[i][d] + c1 * r1 * (pbest[i][d] - positions[i][d]) + c2 * r2 * (gbest[d] - positions[i][d]);
      v = Math.min(vmax, Math.max(-vmax, v)); velocities[i][d] = v;
      positions[i][d] = Math.min(1, Math.max(0, positions[i][d] + v));
    }
  }
  return finalize({ algorithm: 'PSO', p, obj, t0, bestPos: gbest, bestFit: gbestFit, bestEval: gbestEval, convergence, evalHist, iterationHistory: history, parameters, stoppedBy });
}
