/**
 * REAL benchmark engine. Every number is measured from an actual optimizer run.
 *
 *   dataset → same problem instance → same objective & constraints
 *          → algorithm × seed → actual execution → metrics → statistics
 *
 * Fairness protocol (see docs/BENCHMARKING.md):
 *  - one shared road-graph snapshot and one shared path oracle (identical costs)
 *  - identical objective function, decoder, hard constraints and weights
 *  - identical evaluation budget B = populationSize × maxIterations for every
 *    metaheuristic (SA gets B single evaluations; QPSO/AQPSO/PSO/GA get B/N
 *    generations of N evaluations); no early stopping
 *  - identical initial swarm per seed for the population-based methods
 *  - seeds are experiment INPUTS; results are never post-processed
 * NOTHING in this file adds noise, multipliers or fabricated curves.
 */
import os from 'os';
import crypto from 'crypto';
import { AlgorithmId, RunParams, OptimizerResult } from './qpso/types';
import { runAlgorithm } from './index';
import { RouteOracle } from './routeOracle';
import { VrpEvaluation } from './fitness';
import { EXACT_MAX_CUSTOMERS } from './exactSolver';
import { datasetFingerprint } from './datasetGenerator';

export const DEFAULT_SEEDS = [42, 123, 456, 789, 1001];

export interface BenchmarkOptions {
  algorithms?: AlgorithmId[];
  seeds?: number[];
  datasetLabel?: string;
  onRun?: (algo: string, seed: number, res: OptimizerResult) => void;
}

export interface RunRecord {
  algorithm: string; seed: number; bestFitness: number; distanceKm: number; travelTimeMin: number;
  fuelCostInr: number; co2Kg: number; feasible: boolean; constraintViolations: number; iterations: number;
  evaluations: number; runtimeSeconds: number; stoppedBy: string; convergence: number[]; latenessMin: number;
}

export interface AlgoStats {
  algorithm: string; isExact: boolean; runs: number; seeds: number[];
  bestFitness: number; meanFitness: number; worstFitness: number; medianFitness: number; stdDevFitness: number;
  meanRuntime: number; runtimeSeconds: number; meanDistance: number; meanDistanceKm: number; meanTravelTimeMin: number;
  meanFuelCostInr: number; meanCo2Kg: number; feasibilityRate: number; meanConstraintViolations: number;
  meanIterations: number; meanEvaluations: number; meanLatenessMin: number;
  optimalityGapPct: number | null; bestGapPct: number | null;
  convergence: number[]; convergenceStd: number[]; convergenceEvaluations: number[];
  parameters: Record<string, number | string | boolean>;
  vsQPSO?: { meanDiffPct: number; mannWhitneyU: number; pValue: number; verdict: 'better' | 'worse' | 'indistinguishable'; note: string };
}

export interface BenchmarkReport {
  meta: {
    id: string; createdAt: string; datasetLabel: string; datasetFingerprint: string;
    customers: number; vehicles: number; depotId: string; graphNodes: number; graphEdges: number;
    seeds: number[]; populationSize: number; maxIterations: number; evaluationBudget: number;
    objectiveWeights: Record<string, number>; algorithmsRun: string[];
    algorithmsSkipped: { algorithm: string; reason: string }[];
    hardware: { cpu: string; cores: number; totalMemGB: number; node: string; platform: string };
    totalRuntimeSeconds: number; pathCache: { hits: number; misses: number };
    method: string; fairness: string[];
  };
  results: Record<string, AlgoStats>;
  runs: RunRecord[];
  ranking: { algorithm: string; meanFitness: number }[];
}

// ── statistics helpers (exported for tests) ───────────────────────────────
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const stdDev = (a: number[]) => { if (a.length <= 1) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

function erf(x: number) { // Abramowitz–Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Two-sided Mann–Whitney U test (normal approximation, tie-corrected). */
export function mannWhitneyU(a: number[], b: number[]) {
  const n1 = a.length, n2 = b.length;
  if (n1 < 2 || n2 < 2) return { U: NaN, p: NaN };
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array(all.length).fill(0);
  let i = 0, tieTerm = 0;
  while (i < all.length) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1; tieTerm += t ** 3 - t; i = j + 1;
  }
  const R1 = all.reduce((s, x, idx) => s + (x.g === 0 ? ranks[idx] : 0), 0);
  const U1 = R1 - (n1 * (n1 + 1)) / 2; const U = Math.min(U1, n1 * n2 - U1);
  const N = n1 + n2; const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1))));
  if (sigma === 0) return { U, p: 1 };
  const z = (Math.abs(U1 - mu) - 0.5) / sigma;
  return { U, p: Math.min(1, 2 * (1 - normCdf(Math.max(0, z)))) };
}

function resampleConvergence(res: OptimizerResult, N: number, points: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= points; k++) {
    const budget = k * N; let idx = -1;
    for (let i = 0; i < res.evaluationsHistory.length; i++) { if (res.evaluationsHistory[i] <= budget) idx = i; else break; }
    out.push(res.convergence[Math.max(0, idx)]);
  }
  return out;
}

export function runBenchmark(base: RunParams, options: BenchmarkOptions = {}): BenchmarkReport {
  if (!base.customers || !base.fleet || !base.depotId) throw new Error('Benchmark requires a VRP instance (depot, customers, fleet).');
  const t0 = performance.now();
  const seeds = options.seeds?.length ? options.seeds : DEFAULT_SEEDS;
  const requested = options.algorithms?.length ? options.algorithms : (['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT'] as AlgorithmId[]);
  const N = base.populationSize ?? 30;
  const iters = base.maxIterations ?? 100;
  const budget = N * iters;
  const oracle = base.oracle ?? new RouteOracle(base.graph);
  const skipped: { algorithm: string; reason: string }[] = [];
  const runs: RunRecord[] = [];
  const byAlgo = new Map<string, OptimizerResult[]>();

  for (const algo of requested) {
    if (algo === 'EXACT' && base.customers.length > EXACT_MAX_CUSTOMERS) {
      skipped.push({ algorithm: 'EXACT', reason: `NOT EXECUTED — exhaustive search is impractical for N=${base.customers.length} (limit N ≤ ${EXACT_MAX_CUSTOMERS}).` });
      continue;
    }
    const algSeeds = algo === 'EXACT' ? [seeds[0]] : seeds;   // exact is deterministic: one run
    const list: OptimizerResult[] = [];
    for (const seed of algSeeds) {
      const params: RunParams = {
        ...base, oracle, seed, populationSize: N, maxIterations: iters,
        stoppingCriteria: { maxEvaluations: budget, maxRuntimeMs: algo === 'EXACT' ? 60_000 : undefined }, // no early stopping
      };
      const res = runAlgorithm(algo, params);
      list.push(res);
      const e = res.bestEval as VrpEvaluation;
      runs.push({
        algorithm: algo, seed, bestFitness: res.bestFitness, distanceKm: e.distanceKm, travelTimeMin: e.durationMin,
        fuelCostInr: e.fuelCostInr, co2Kg: e.co2Kg, feasible: res.feasible, constraintViolations: res.constraintViolations.length,
        iterations: res.iterations, evaluations: res.evaluations, runtimeSeconds: res.runtimeSeconds, stoppedBy: res.stoppedBy,
        convergence: algo === 'EXACT' ? res.convergence : resampleConvergence(res, N, iters), latenessMin: e.latenessMin ?? 0,
      });
      options.onRun?.(algo, seed, res);
    }
    byAlgo.set(algo, list);
  }

  const exactRes = byAlgo.get('EXACT')?.[0];
  const exactFit = exactRes && exactRes.parameters.complete !== false ? exactRes.bestFitness : null;
  const results: Record<string, AlgoStats> = {};
  for (const [algo, list] of byAlgo) {
    const rs = runs.filter((r) => r.algorithm === algo);
    const fits = rs.map((r) => r.bestFitness);
    const isExact = algo === 'EXACT';
    const convLen = isExact ? list[0].convergence.length : iters;
    const conv: number[] = [], convStd: number[] = [];
    for (let k = 0; k < convLen; k++) { const col = rs.map((r) => r.convergence[k]).filter((v) => Number.isFinite(v)); conv.push(mean(col)); convStd.push(stdDev(col)); }
    const m = mean(fits);
    results[algo] = {
      algorithm: algo, isExact, runs: rs.length, seeds: rs.map((r) => r.seed),
      bestFitness: Math.min(...fits), meanFitness: m, worstFitness: Math.max(...fits), medianFitness: median(fits), stdDevFitness: stdDev(fits),
      meanRuntime: mean(rs.map((r) => r.runtimeSeconds)), runtimeSeconds: mean(rs.map((r) => r.runtimeSeconds)),
      meanDistance: mean(rs.map((r) => r.distanceKm)), meanDistanceKm: mean(rs.map((r) => r.distanceKm)),
      meanTravelTimeMin: mean(rs.map((r) => r.travelTimeMin)), meanFuelCostInr: mean(rs.map((r) => r.fuelCostInr)), meanCo2Kg: mean(rs.map((r) => r.co2Kg)),
      feasibilityRate: rs.filter((r) => r.feasible).length / rs.length, meanConstraintViolations: mean(rs.map((r) => r.constraintViolations)),
      meanIterations: mean(rs.map((r) => r.iterations)), meanEvaluations: mean(rs.map((r) => r.evaluations)), meanLatenessMin: mean(rs.map((r) => r.latenessMin)),
      optimalityGapPct: exactFit !== null && !isExact ? ((m - exactFit) / Math.max(1e-9, Math.abs(exactFit))) * 100 : null,
      bestGapPct: exactFit !== null && !isExact ? ((Math.min(...fits) - exactFit) / Math.max(1e-9, Math.abs(exactFit))) * 100 : null,
      convergence: conv, convergenceStd: convStd,
      convergenceEvaluations: isExact ? list[0].evaluationsHistory : Array.from({ length: iters }, (_, k) => (k + 1) * N),
      parameters: list[0].parameters,
    };
  }
  // statistical comparison against QPSO (paired seeds, non-parametric)
  const q = results['QPSO'];
  if (q) {
    const qf = runs.filter((r) => r.algorithm === 'QPSO').map((r) => r.bestFitness);
    for (const [algo, st] of Object.entries(results)) {
      if (algo === 'QPSO' || st.isExact) continue;
      const af = runs.filter((r) => r.algorithm === algo).map((r) => r.bestFitness);
      const { U, p } = mannWhitneyU(qf, af);
      const diff = ((st.meanFitness - q.meanFitness) / Math.max(1e-9, Math.abs(q.meanFitness))) * 100;
      const sig = Number.isFinite(p) && p < 0.05;
      st.vsQPSO = {
        meanDiffPct: diff, mannWhitneyU: U, pValue: p,
        verdict: !sig ? 'indistinguishable' : st.meanFitness > q.meanFitness ? 'worse' : 'better',
        note: `${algo} vs QPSO on ${qf.length} vs ${af.length} runs (two-sided Mann–Whitney U). Positive % = ${algo} has higher (worse) mean fitness. ${qf.length < 10 ? 'Few runs ⇒ low statistical power; treat "indistinguishable" as inconclusive.' : ''}`.trim(),
      };
    }
  }

  const fp = datasetFingerprint(base.customers, base.fleet, base.depotId);
  const cpus = os.cpus();
  const report: BenchmarkReport = {
    meta: {
      id: `BM-${crypto.createHash('sha256').update(`${fp}|${seeds.join(',')}|${N}|${iters}|${requested.join(',')}|${Date.now()}`).digest('hex').slice(0, 8).toUpperCase()}`,
      createdAt: new Date().toISOString(), datasetLabel: options.datasetLabel ?? 'custom instance', datasetFingerprint: fp,
      customers: base.customers.length, vehicles: base.fleet.length, depotId: base.depotId, graphNodes: base.graph.nodes.size, graphEdges: base.graph.edges.size,
      seeds, populationSize: N, maxIterations: iters, evaluationBudget: budget, objectiveWeights: { ...base.weights },
      algorithmsRun: [...byAlgo.keys()], algorithmsSkipped: skipped,
      hardware: { cpu: cpus[0]?.model ?? 'unknown', cores: cpus.length, totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10, node: process.version, platform: `${os.platform()} ${os.arch()}` },
      totalRuntimeSeconds: (performance.now() - t0) / 1000, pathCache: { hits: oracle.hits, misses: oracle.misses },
      method: 'Each algorithm is executed for every seed on the identical instance; statistics are computed over the actual per-seed results.',
      fairness: [
        'Same road-graph snapshot, path oracle, objective function, decoder and hard constraints for all algorithms.',
        `Equal evaluation budget: ${budget} objective evaluations per run (${N} × ${iters}); SA uses the same budget one evaluation at a time (±1 initial evaluation).`,
        'No early stopping for any algorithm.',
        'Population-based algorithms share the identical initial swarm per seed; SA starts from its first member.',
        'EXACT enumerates every permutation of the decoded search space (optimal within that space, not a proof of global VRP optimality); it runs once because it is deterministic.',
        'Optimality gap is only reported when the exact solver ran to completion on the same instance.',
      ],
    },
    results, runs,
    ranking: Object.values(results).filter((r) => !r.isExact).map((r) => ({ algorithm: r.algorithm, meanFitness: r.meanFitness })).sort((a, b) => a.meanFitness - b.meanFitness),
  };
  return report;
}
