/**
 * CANONICAL QPSO — the only Quantum-behaved Particle Swarm implementation in
 * QUANTARA. Every consumer (single-route optimizer, VRP, benchmark, scalability,
 * scenario engine, digital twin, SIH demo) calls this module.
 *
 * "Quantum-inspired" means: a CLASSICAL algorithm whose particle dynamics are
 * modelled on a quantum potential-well (delta-potential) picture (Sun, Feng & Xu,
 * 2004). It runs on ordinary CPUs — no quantum hardware is involved.
 *
 * Particle representation
 *   x_i ∈ [0,1]^n  — one random key per customer/waypoint; decoded by argsort
 *   (see waypointOrder.ts) into a giant tour, then split across vehicles.
 *
 * Per iteration t (after evaluating the swarm):
 *   pbest_i  ← x_i           if f(x_i) < f(pbest_i)
 *   gbest    ← argmin f(pbest)
 *   mbest_d  = (1/N) Σ_i pbest_{i,d}                          (mean best position)
 *   φ, u ~ U(0,1)  independently per particle & dimension
 *   p_{i,d}  = φ·pbest_{i,d} + (1−φ)·gbest_d                  (local attractor)
 *   x_{i,d}  ← p_{i,d} ± β·|mbest_d − x_{i,d}|·ln(1/u)         (sign: +/− with prob ½)
 *   x_{i,d}  ← clamp(x_{i,d}, 0, 1)
 *
 * β is the contraction–expansion coefficient. Static QPSO decays it linearly
 * βmax → βmin (wide exploration early, fine exploitation late). Adaptive QPSO
 * (AdaptiveQPSO.ts) replaces that schedule with a feedback controller.
 */
import { RunParams, OptimizerResult, IterationRecord } from './types';
import { createObjective, trivialResult, finalize, opRng, swarmDiversity, budgetIterations, AnyEval } from './objective';
import { initialPopulation } from '../rng';
import type { AdaptiveController } from './AdaptiveQPSO';

export const QPSO_DEFAULTS = { populationSize: 30, maxIterations: 100, betaMax: 1.0, betaMin: 0.4 };

export function qpsoCore(p: RunParams, controller?: AdaptiveController): OptimizerResult {
  const t0 = performance.now();
  const algorithm = controller ? 'AQPSO' : 'QPSO';
  const obj = createObjective(p);
  const n = obj.dimension;
  const N = p.populationSize ?? QPSO_DEFAULTS.populationSize;
  const betaMax = p.betaMax ?? QPSO_DEFAULTS.betaMax;
  const betaMin = p.betaMin ?? QPSO_DEFAULTS.betaMin;
  const seed = p.seed ?? 42;
  const maxIter = budgetIterations(p, N, QPSO_DEFAULTS.maxIterations);
  const parameters = { populationSize: N, maxIterations: maxIter, betaMax, betaMin, schedule: controller ? 'adaptive-feedback' : 'linear-decay', dimension: n };
  if (n === 0) return trivialResult(algorithm, p, obj, t0, parameters);

  const rand = opRng(seed, 0x51505);
  const positions = initialPopulation(seed, N, n);
  const pbest = positions.map((x) => [...x]);
  const pbestFit: number[] = new Array(N).fill(Infinity);
  let gbest = [...positions[0]];
  let gbestFit = Infinity;
  let gbestEval: AnyEval | undefined;

  const convergence: number[] = [];
  const evalHist: number[] = [];
  const history: IterationRecord[] = [];
  const crit = p.stoppingCriteria ?? {};
  let stagnation = 0;
  let stoppedBy: ReturnType<typeof finalize>['stoppedBy'] = 'MAX_ITERATIONS';
  const diversityRef = 0.25; // E|U − mean| for a uniform swarm

  for (let it = 0; it < maxIter; it++) {
    let fitSum = 0;
    const prevBest = gbestFit;
    for (let i = 0; i < N; i++) {
      const r = obj.evaluate(positions[i]);
      fitSum += r.fitness;
      if (r.fitness < pbestFit[i]) { pbestFit[i] = r.fitness; pbest[i] = [...positions[i]]; }
      if (r.fitness < gbestFit) { gbestFit = r.fitness; gbest = [...positions[i]]; gbestEval = r.eval; }
    }
    convergence.push(gbestFit);
    evalHist.push(obj.evaluations);
    const improved = gbestFit < prevBest - 1e-9;
    stagnation = improved ? 0 : stagnation + 1;

    const diversity = swarmDiversity(positions);
    let beta: number;
    let restartIdx: number[] = [];
    if (controller) {
      const step = controller.step({ iteration: it, maxIter, diversity: diversity / diversityRef, improved, stagnation });
      beta = step.beta;
      if (step.restart) {
        const k = Math.max(1, Math.floor(N * controller.config.restartFraction));
        restartIdx = pbestFit.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f || a.i - b.i).slice(0, k).map((x) => x.i);
      }
    } else {
      beta = betaMax - (betaMax - betaMin) * (it / Math.max(1, maxIter - 1));
    }
    history.push({ iteration: it + 1, evaluations: obj.evaluations, bestFitness: gbestFit, meanFitness: fitSum / N, diversity, beta });
    p.onProgress?.(it + 1, maxIter, gbestFit);

    if (crit.targetFitness !== undefined && gbestFit <= crit.targetFitness) { stoppedBy = 'TARGET'; break; }
    if (crit.stagnationLimit !== undefined && stagnation >= crit.stagnationLimit) { stoppedBy = 'STAGNATION'; break; }
    if (crit.maxRuntimeMs !== undefined && performance.now() - t0 > crit.maxRuntimeMs) { stoppedBy = 'RUNTIME'; break; }
    if (it === maxIter - 1) break;

    // ── mbest, attractor, quantum position update ──
    const mbest = new Array(n).fill(0);
    for (let d = 0; d < n; d++) { let s = 0; for (let i = 0; i < N; i++) s += pbest[i][d]; mbest[d] = s / N; }

    const fresh = new Set(restartIdx);
    for (const i of restartIdx) {                       // diversity injection (adaptive only), seeded ⇒ deterministic
      for (let d = 0; d < n; d++) positions[i][d] = rand();
      pbest[i] = [...positions[i]]; pbestFit[i] = Infinity;
    }
    for (let i = 0; i < N; i++) {
      if (fresh.has(i)) continue;
      for (let d = 0; d < n; d++) {
        const phi = rand();
        const attractor = phi * pbest[i][d] + (1 - phi) * gbest[d];
        const u = Math.max(1e-12, rand());
        const sign = rand() < 0.5 ? -1 : 1;
        const x = attractor + sign * beta * Math.abs(mbest[d] - positions[i][d]) * Math.log(1 / u);
        positions[i][d] = Math.min(1, Math.max(0, x));
      }
    }
  }

  return finalize({
    algorithm, p, obj, t0, bestPos: gbest, bestFit: gbestFit, bestEval: gbestEval,
    convergence, evalHist, iterationHistory: history, parameters, stoppedBy,
    adaptive: controller?.trace(),
  });
}

export function runQPSO(p: RunParams): OptimizerResult { return qpsoCore(p); }
