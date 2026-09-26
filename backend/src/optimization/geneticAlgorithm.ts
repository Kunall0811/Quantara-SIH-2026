/** Genetic Algorithm baseline: elitism + tournament selection + blend crossover + Gaussian-style mutation on random keys. */
import { RunParams, OptimizerResult, IterationRecord } from './qpso/types';
import { createObjective, trivialResult, finalize, opRng, swarmDiversity, budgetIterations, AnyEval } from './qpso/objective';
import { initialPopulation } from './rng';

export const GA_DEFAULTS = { populationSize: 30, maxIterations: 100, mutationRate: 0.15, eliteFraction: 0.1, tournamentSize: 3, mutationStep: 0.3 };

export function runGA(p: RunParams): OptimizerResult {
  const t0 = performance.now();
  const obj = createObjective(p); const n = obj.dimension;
  const N = p.populationSize ?? GA_DEFAULTS.populationSize;
  const { mutationRate, eliteFraction, tournamentSize, mutationStep } = GA_DEFAULTS;
  const seed = p.seed ?? 42;
  const maxIter = budgetIterations(p, N, GA_DEFAULTS.maxIterations);
  const eliteN = Math.max(1, Math.floor(N * eliteFraction));
  const parameters = { populationSize: N, maxIterations: maxIter, mutationRate, eliteFraction, tournamentSize, mutationStep, dimension: n };
  if (n === 0) return trivialResult('GA', p, obj, t0, parameters);

  const rand = opRng(seed, 0x6a01);
  let pop = initialPopulation(seed, N, n);
  let gbestFit = Infinity; let gbestEval: AnyEval | undefined; let gbest = [...pop[0]];
  const convergence: number[] = [], evalHist: number[] = [], history: IterationRecord[] = [];
  const crit = p.stoppingCriteria ?? {}; let stagnation = 0; let stoppedBy: OptimizerResult['stoppedBy'] = 'MAX_ITERATIONS';

  const tournament = (fits: number[]): number => {
    let best = Math.floor(rand() * N);
    for (let k = 1; k < tournamentSize; k++) { const idx = Math.floor(rand() * N); if (fits[idx] < fits[best]) best = idx; }
    return best;
  };

  for (let it = 0; it < maxIter; it++) {
    const prev = gbestFit;
    const evals = pop.map((ind) => obj.evaluate(ind));
    const fits = evals.map((e) => e.fitness);
    evals.forEach((e, i) => { if (e.fitness < gbestFit) { gbestFit = e.fitness; gbestEval = e.eval; gbest = [...pop[i]]; } });
    convergence.push(gbestFit); evalHist.push(obj.evaluations);
    stagnation = gbestFit < prev - 1e-9 ? 0 : stagnation + 1;
    history.push({ iteration: it + 1, evaluations: obj.evaluations, bestFitness: gbestFit, meanFitness: fits.reduce((a, b) => a + b, 0) / N, diversity: swarmDiversity(pop) });
    p.onProgress?.(it + 1, maxIter, gbestFit);
    if (crit.targetFitness !== undefined && gbestFit <= crit.targetFitness) { stoppedBy = 'TARGET'; break; }
    if (crit.stagnationLimit !== undefined && stagnation >= crit.stagnationLimit) { stoppedBy = 'STAGNATION'; break; }
    if (crit.maxRuntimeMs !== undefined && performance.now() - t0 > crit.maxRuntimeMs) { stoppedBy = 'RUNTIME'; break; }
    if (it === maxIter - 1) break;

    const order = pop.map((_, i) => i).sort((a, b) => fits[a] - fits[b] || a - b);
    const next: number[][] = order.slice(0, eliteN).map((i) => [...pop[i]]);
    while (next.length < N) {
      const p1 = pop[tournament(fits)], p2 = pop[tournament(fits)];
      next.push(p1.map((v, d) => {
        const a = rand();
        let val = a * v + (1 - a) * p2[d];
        if (rand() < mutationRate) val += (rand() - 0.5) * mutationStep * 2;
        return Math.min(1, Math.max(0, val));
      }));
    }
    pop = next;
  }
  return finalize({ algorithm: 'GA', p, obj, t0, bestPos: gbest, bestFit: gbestFit, bestEval: gbestEval, convergence, evalHist, iterationHistory: history, parameters, stoppedBy });
}
