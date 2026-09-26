import fs from 'fs';
import path from 'path';
import { runQPSO, runAdaptiveQPSO, runPSO, runGA, runSA, runExact, runAlgorithm, ALGORITHMS } from '../src/optimization';
import { AdaptiveController } from '../src/optimization/qpso/AdaptiveQPSO';
import { puneVrp } from './helpers';

const finite = (x: number) => Number.isFinite(x);

describe('canonical QPSO', () => {
  const base = puneVrp(6, 3);

  it('returns the full result contract', () => {
    const r = runQPSO(base);
    expect(r.algorithm).toBe('QPSO');
    expect(r.seed).toBe(42);
    expect(r.bestSolution).toHaveLength(6);
    expect(finite(r.bestFitness)).toBe(true);
    expect(r.convergenceHistory).toEqual(r.convergence);
    expect(r.iterationHistory).toHaveLength(r.iterations);
    expect(r.parameters).toMatchObject({ populationSize: 16, maxIterations: 25, betaMax: 1, betaMin: 0.4 });
    expect(typeof r.feasible).toBe('boolean');
    expect(Array.isArray(r.constraintViolations)).toBe(true);
    expect(r.runtimeSeconds).toBeGreaterThanOrEqual(0);
    expect(r.evaluations).toBe(16 * 25);
  });

  it('is bit-for-bit reproducible for identical dataset + parameters + seed', () => {
    const a = runQPSO(base), b = runQPSO({ ...base, oracle: undefined });
    expect(b.convergence).toEqual(a.convergence);
    expect(b.bestSolution).toEqual(a.bestSolution);
    expect(b.bestFitness).toBe(a.bestFitness);
  });

  it('different seeds explore differently', () => {
    expect(runQPSO({ ...base, seed: 1 }).convergence).not.toEqual(runQPSO({ ...base, seed: 2 }).convergence);
  });

  it('gbest never gets worse (monotone non-increasing convergence)', () => {
    const c = runQPSO(base).convergence;
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1] + 1e-9);
  });

  it('β decays linearly βmax→βmin for static QPSO and matches the documented equation', () => {
    const r = runQPSO({ ...base, maxIterations: 11 });
    const betas = r.iterationHistory.map((h) => h.beta!);
    expect(betas[0]).toBeCloseTo(1.0, 10);
    expect(betas[betas.length - 1]).toBeCloseTo(0.4, 10);
    betas.forEach((b, i) => expect(b).toBeCloseTo(1.0 - 0.6 * (i / 10), 10));
  });

  it('respects an evaluation budget and stopping criteria', () => {
    expect(runQPSO({ ...base, stoppingCriteria: { maxEvaluations: 16 * 5 } }).iterations).toBe(5);
    const early = runQPSO({ ...base, maxIterations: 200, stoppingCriteria: { stagnationLimit: 3 } });
    expect(early.stoppedBy).toBe('STAGNATION');
    expect(early.iterations).toBeLessThan(200);
  });

  it('handles empty / single-stop problems without crashing', () => {
    const one = runQPSO({ ...base, customers: base.customers!.slice(0, 1) });
    expect(one.bestSolution).toHaveLength(1);
    expect(finite(one.bestFitness)).toBe(true);
  });

  it('there is exactly ONE QPSO implementation (no duplicate mbest/ln(1/u) update in the codebase)', () => {
    const root = path.join(__dirname, '../src');
    const hits: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.ts$/.test(e.name) && /Math\.log\(1\s*\/\s*u\)/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(root, f));
    });
    walk(root);
    expect(hits).toEqual(['optimization/qpso/QPSO.ts']);
    expect(fs.existsSync(path.join(root, 'optimization/vrpRunner.ts'))).toBe(false);
  });
});

describe('Adaptive QPSO', () => {
  const base = puneVrp(8, 3, 11, { maxIterations: 60, populationSize: 20 });

  it('actually executes an adaptive controller and returns every trace', () => {
    const r = runAdaptiveQPSO(base);
    expect(r.algorithm).toBe('AQPSO');
    const a = r.adaptive!;
    for (const k of ['betaHistory', 'diversityHistory', 'explorationHistory', 'exploitationHistory', 'stagnationHistory', 'adaptiveHistory'] as const) expect(a[k]).toBeDefined();
    expect(a.betaHistory).toHaveLength(r.iterations);
    a.explorationHistory.forEach((e, i) => expect(e + a.exploitationHistory[i]).toBeCloseTo(1, 10));
  });

  it('adaptive β differs from the static linear schedule (adaptation influences search)', () => {
    const s = runQPSO(base), a = runAdaptiveQPSO(base);
    const sb = s.iterationHistory.map((h) => h.beta!), ab = a.adaptive!.betaHistory;
    expect(ab).not.toEqual(sb);
    expect(ab.some((b, i) => Math.abs(b - sb[i]) > 1e-6)).toBe(true);
    expect(a.convergence).not.toEqual(s.convergence);
  });

  it('β stays inside [βmin, βcap]', () => {
    const r = runAdaptiveQPSO(base);
    r.adaptive!.betaHistory.forEach((b) => { expect(b).toBeGreaterThanOrEqual(0.4 - 1e-12); expect(b).toBeLessThanOrEqual(1.3 + 1e-12); });
  });

  it('is deterministic under a fixed seed', () => {
    const a = runAdaptiveQPSO(base), b = runAdaptiveQPSO(base);
    expect(b.convergence).toEqual(a.convergence);
    expect(b.adaptive!.betaHistory).toEqual(a.adaptive!.betaHistory);
    expect(b.adaptive!.adaptiveHistory).toEqual(a.adaptive!.adaptiveHistory);
  });

  it('controller: stagnation boosts β, low diversity expands, and restarts fire at the restart window', () => {
    const c = new AdaptiveController({ restartWindow: 4, stagnationWindow: 4 });
    const healthy = c.step({ iteration: 10, maxIter: 100, diversity: 0.9, improved: true, stagnation: 0 }).beta;
    const stuck = c.step({ iteration: 10, maxIter: 100, diversity: 0.9, improved: false, stagnation: 4 });
    expect(stuck.beta).toBeGreaterThan(healthy);
    expect(stuck.restart).toBe(true);
    const collapsed = c.step({ iteration: 10, maxIter: 100, diversity: 0.05, improved: true, stagnation: 0 }).beta;
    expect(collapsed).toBeGreaterThan(healthy);
    expect(c.trace().restarts).toBe(1);
  });

  it('records restarts when the search stalls', () => {
    const r = runAdaptiveQPSO({ ...base, maxIterations: 120, adaptive: { restartWindow: 3, stagnationWindow: 3 } });
    expect(r.adaptive!.restarts).toBeGreaterThan(0);
    expect(r.adaptive!.adaptiveHistory.some((h) => h.action === 'RESTART')).toBe(true);
  });
});

describe('baseline algorithms are real and share the objective', () => {
  const base = puneVrp(6, 3);
  it.each(['PSO', 'GA', 'SA'] as const)('%s runs, is reproducible and reports honest evaluations', (id) => {
    const a = runAlgorithm(id, base), b = runAlgorithm(id, base);
    expect(b.convergence).toEqual(a.convergence);
    expect(finite(a.bestFitness)).toBe(true);
    expect(a.evaluations).toBeGreaterThan(0);
    expect(a.parameters).toBeDefined();
  });
  it('registry exposes all six algorithms', () => {
    expect(Object.keys(ALGORITHMS).sort()).toEqual(['AQPSO', 'EXACT', 'GA', 'PSO', 'QPSO', 'SA']);
  });
  it('all algorithms use the same initial swarm (iteration-1 best is identical for population methods)', () => {
    const q = runQPSO(base), p = runPSO(base), g = runGA(base);
    expect(p.convergence[0]).toBe(q.convergence[0]);
    expect(g.convergence[0]).toBe(q.convergence[0]);
  });
  it('EXACT is a lower bound for every metaheuristic on the same decoded space', () => {
    const small = puneVrp(6, 3, 5, { populationSize: 20, maxIterations: 40 });
    const ex = runExact(small);
    expect(ex.stoppedBy).toBe('EXACT_COMPLETE');
    for (const id of ['QPSO', 'AQPSO', 'PSO', 'GA', 'SA'] as const) expect(runAlgorithm(id, small).bestFitness).toBeGreaterThanOrEqual(ex.bestFitness - 1e-9);
  });
  it('EXACT refuses instances that are too large instead of pretending', () => {
    expect(() => runExact(puneVrp(12, 3))).toThrow(/limited to small instances/);
  });
});
