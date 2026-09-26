/**
 * Optimization registry — the ONE place every caller (API, benchmark, scalability,
 * digital twin, scenario engine, SIH demo) resolves an algorithm from.
 */
import { AlgorithmId, RunParams, OptimizerResult } from './qpso/types';
import { runQPSO } from './qpso/QPSO';
import { runAdaptiveQPSO } from './qpso/AdaptiveQPSO';
import { runPSO } from './pso';
import { runGA } from './geneticAlgorithm';
import { runSA } from './simulatedAnnealing';
import { runExact } from './exactSolver';

export * from './qpso/types';
export { runQPSO, runAdaptiveQPSO, runPSO, runGA, runSA, runExact };

export const ALGORITHMS: Record<AlgorithmId, (p: RunParams) => OptimizerResult> = {
  QPSO: runQPSO, AQPSO: runAdaptiveQPSO, PSO: runPSO, GA: runGA, SA: runSA, EXACT: runExact,
};
export const ALL_ALGORITHM_IDS = Object.keys(ALGORITHMS) as AlgorithmId[];

export function isAlgorithmId(x: string): x is AlgorithmId { return x in ALGORITHMS; }

export function runAlgorithm(id: AlgorithmId | string, p: RunParams): OptimizerResult {
  const key = (id === 'ADAPTIVE_QPSO' ? 'AQPSO' : id.toUpperCase()) as AlgorithmId;
  const fn = ALGORITHMS[key];
  if (!fn) throw new Error(`Unknown optimization algorithm: ${id}`);
  return fn(p);
}
