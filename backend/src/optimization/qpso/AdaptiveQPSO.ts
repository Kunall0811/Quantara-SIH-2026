/**
 * ADAPTIVE QPSO — same quantum-behaved position update as QPSO.ts, but the
 * contraction–expansion coefficient β_t is produced by a deterministic feedback
 * controller instead of a fixed linear schedule:
 *
 *   τ        = t / (T−1)                                  (progress 0→1)
 *   β_base   = β_max − (β_max − β_min)·τ                  (classic schedule as prior)
 *   D̂_t      = swarm diversity / 0.25                     (1 ≈ fresh uniform swarm)
 *   D*_t     = max(D_floor, (1−τ)^γ)                      (diversity the run SHOULD have)
 *   Δ_div    = k_d · (D*_t − D̂_t)                         (swarm contracting too fast → expand)
 *   Δ_stag   = k_s · min(1, s_t / S)                      (s_t = iterations without gbest gain)
 *   β_t      = clamp(β_base + Δ_div + Δ_stag, β_min, β_cap)
 *   explore  = (β_t − β_min)/(β_cap − β_min) ; exploit = 1 − explore
 *
 * Diversity injection: if s_t ≥ restartWindow and τ < lateRestartCutoff, the worst
 * ⌈ρN⌉ particles are re-seeded (from the run's seeded RNG) and s_t restarts.
 *
 * Everything is a pure function of the observed swarm statistics and the seed, so
 * a fixed (dataset, parameters, seed) reproduces bit-for-bit. The controller
 * actually changes β_t and the swarm — see the unit tests that assert the β trace
 * differs from the static schedule and that restarts are recorded.
 */
import { AdaptiveParams, AdaptiveTrace, OptimizerResult, RunParams } from './types';
import { qpsoCore, QPSO_DEFAULTS } from './QPSO';

export const ADAPTIVE_DEFAULTS: Required<AdaptiveParams> = {
  betaCap: 1.3, diversityGain: 0.6, stagnationGain: 0.35, stagnationWindow: 8,
  restartWindow: 14, restartFraction: 0.2, lateRestartCutoff: 0.85,
};
const D_FLOOR = 0.06;

export interface AdaptiveStepInput { iteration: number; maxIter: number; diversity: number; improved: boolean; stagnation: number }
export interface AdaptiveStepOutput { beta: number; exploration: number; exploitation: number; restart: boolean }

export class AdaptiveController {
  readonly config: Required<AdaptiveParams>;
  private betaMin: number; private betaMax: number;
  private t: AdaptiveTrace;
  constructor(cfg: AdaptiveParams = {}, betaMin = QPSO_DEFAULTS.betaMin, betaMax = QPSO_DEFAULTS.betaMax) {
    this.config = { ...ADAPTIVE_DEFAULTS, ...cfg };
    this.betaMin = betaMin; this.betaMax = betaMax;
    this.t = {
      betaHistory: [], diversityHistory: [], targetDiversityHistory: [], explorationHistory: [],
      exploitationHistory: [], stagnationHistory: [], adaptiveHistory: [], restarts: 0, parameters: this.config,
    };
  }

  step(s: AdaptiveStepInput): AdaptiveStepOutput {
    const c = this.config;
    const tau = s.maxIter > 1 ? s.iteration / (s.maxIter - 1) : 1;
    const base = this.betaMax - (this.betaMax - this.betaMin) * tau;
    const target = Math.max(D_FLOOR, 1 - tau);
    const dDiv = c.diversityGain * (target - s.diversity);
    const dStag = c.stagnationGain * Math.min(1, s.stagnation / c.stagnationWindow);
    const beta = Math.min(c.betaCap, Math.max(this.betaMin, base + dDiv + dStag));
    const exploration = (beta - this.betaMin) / Math.max(1e-9, c.betaCap - this.betaMin);
    const restart = s.stagnation >= c.restartWindow && tau < c.lateRestartCutoff && s.stagnation % c.restartWindow === 0;

    this.t.betaHistory.push(beta);
    this.t.diversityHistory.push(s.diversity);
    this.t.targetDiversityHistory.push(target);
    this.t.explorationHistory.push(exploration);
    this.t.exploitationHistory.push(1 - exploration);
    this.t.stagnationHistory.push(s.stagnation);
    const it = s.iteration + 1;
    if (restart) {
      this.t.restarts++;
      this.t.adaptiveHistory.push({ iteration: it, action: 'RESTART', beta, reason: `no improvement for ${s.stagnation} iterations; re-seeding ${Math.max(1, Math.floor(c.restartFraction * 100))}% worst particles` });
    } else if (dStag > 0.5 * c.stagnationGain) {
      this.t.adaptiveHistory.push({ iteration: it, action: 'BOOST', beta, reason: `stagnation ${s.stagnation}/${c.stagnationWindow}: raising β to widen search` });
    } else if (dDiv < -0.05) {
      this.t.adaptiveHistory.push({ iteration: it, action: 'SETTLE', beta, reason: `swarm more diverse than target (${s.diversity.toFixed(2)} > ${target.toFixed(2)}): lowering β to exploit` });
    }
    return { beta, exploration, exploitation: 1 - exploration, restart };
  }

  trace(): AdaptiveTrace { return this.t; }
}

export function runAdaptiveQPSO(p: RunParams): OptimizerResult {
  const controller = new AdaptiveController(p.adaptive, p.betaMin ?? QPSO_DEFAULTS.betaMin, p.betaMax ?? QPSO_DEFAULTS.betaMax);
  return qpsoCore(p, controller);
}
