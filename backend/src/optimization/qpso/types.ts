import { RoadGraph } from '../graph';
import { RouteOracle } from '../routeOracle';
import { FitnessWeights, VehicleProfileLite, WeatherContext, RouteEvaluation, Customer, VrpEvaluation } from '../fitness';

export type AlgorithmId = 'QPSO' | 'AQPSO' | 'PSO' | 'GA' | 'SA' | 'EXACT';
export const ALGORITHM_LABELS: Record<AlgorithmId, string> = {
  QPSO: 'QPSO (quantum-inspired PSO)', AQPSO: 'Adaptive QPSO', PSO: 'PSO (classical)',
  GA: 'Genetic Algorithm', SA: 'Simulated Annealing', EXACT: 'Exact (exhaustive over decoded space)',
};

export interface StoppingCriteria {
  /** stop after this many consecutive iterations without a gbest improvement (default: never) */
  stagnationLimit?: number;
  /** stop as soon as the best fitness is <= this value */
  targetFitness?: number;
  /** total objective-evaluation budget (fair budget across algorithms) */
  maxEvaluations?: number;
  /** wall-clock guard */
  maxRuntimeMs?: number;
}

export interface AdaptiveParams {
  betaCap?: number;            // upper bound of the adaptive contraction-expansion coefficient
  diversityGain?: number;      // k_d
  stagnationGain?: number;     // k_s
  stagnationWindow?: number;   // S: iterations of no improvement for a full β boost
  restartWindow?: number;      // iterations of no improvement before diversity injection
  restartFraction?: number;    // fraction of worst particles re-seeded on restart
  lateRestartCutoff?: number;  // no restarts after this fraction of the run
}

export interface RunParams {
  graph: RoadGraph;
  waypointIds?: string[]; originId?: string; destinationId?: string; vehicle?: VehicleProfileLite; // single-vehicle multi-stop
  depotId?: string; customers?: Customer[]; fleet?: VehicleProfileLite[];                          // VRP
  weights: FitnessWeights;
  weather: WeatherContext;
  populationSize?: number;
  maxIterations?: number;
  seed?: number;
  algo?: 'dijkstra' | 'astar';
  betaMin?: number; betaMax?: number;
  adaptive?: AdaptiveParams;
  stoppingCriteria?: StoppingCriteria;
  /** schedule start (minutes from 00:00). Customer windows are absolute minutes from 00:00. */
  startTimeMin?: number;
  /** share one path cache between runs on the same (unchanged) graph */
  oracle?: RouteOracle;
  onProgress?: (iteration: number, total: number, bestFitness: number) => void;
}

export interface IterationRecord {
  iteration: number; evaluations: number; bestFitness: number; meanFitness: number;
  diversity: number; beta?: number;
}

export interface AdaptiveTrace {
  betaHistory: number[];
  diversityHistory: number[];          // normalised (1 = initial uniform swarm)
  targetDiversityHistory: number[];
  explorationHistory: number[];        // 0..1
  exploitationHistory: number[];       // 1 - exploration
  stagnationHistory: number[];
  adaptiveHistory: { iteration: number; action: 'BOOST' | 'RESTART' | 'SETTLE'; reason: string; beta: number }[];
  restarts: number;
  parameters: Required<AdaptiveParams>;
}

export interface OptimizerResult {
  algorithm: AlgorithmId | string;
  seed: number;
  parameters: Record<string, number | string | boolean>;
  bestSolution: number[];               // random-key position vector of the best particle
  bestOrder: string[];                  // decoded visiting order (legacy UI shape)
  bestFitness: number;
  bestEval: VrpEvaluation | RouteEvaluation;
  convergence: number[];                // gbest per iteration
  convergenceHistory: number[];         // alias of `convergence`
  evaluationsHistory: number[];         // cumulative objective evaluations at the end of each iteration
  iterationHistory: IterationRecord[];
  runtimeSeconds: number;
  runtime: number;                      // alias (seconds)
  iterations: number;
  evaluations: number;
  feasible: boolean;
  feasibility: boolean;                 // alias
  constraintViolations: { code: string; message: string }[];
  adaptive?: AdaptiveTrace;
  stoppedBy: 'MAX_ITERATIONS' | 'STAGNATION' | 'TARGET' | 'RUNTIME' | 'BUDGET' | 'EXACT_COMPLETE' | 'TRIVIAL';
}
