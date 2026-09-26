/**
 * Single seeded PRNG used by every optimizer, dataset generator and Monte-Carlo
 * routine. Reproducibility-critical code must NEVER call Math.random().
 */
export type Rng = () => number;

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample via Box–Muller (uses two uniforms from `rng`). */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic 32-bit string hash (FNV-1a) — used to derive sub-seeds from labels. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Shared initial swarm: every population-based algorithm starts from the SAME
 *  positions for a given (seed, N, n), which makes paired comparisons fair. */
export function initialPopulation(seed: number, populationSize: number, dimension: number): number[][] {
  const rng = mulberry32(seed);
  return Array.from({ length: populationSize }, () => Array.from({ length: dimension }, () => rng()));
}
