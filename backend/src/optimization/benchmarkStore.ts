import { BenchmarkReport } from './benchmarkEngine';
import { saveJson, loadJson } from '../services/persistence';

/** Most recent REAL benchmark report (persisted) — FRIDAY, the Advanced Lab and the SIH demo read from here, never from constants. */
let last: BenchmarkReport | null = null;
export function setLastBenchmark(r: BenchmarkReport) { last = r; saveJson('last-benchmark', r); }
export function getLastBenchmark(): BenchmarkReport | null { if (!last) last = loadJson<BenchmarkReport>('last-benchmark'); return last; }
export function clearLastBenchmark() { last = null; }
export function setLastBenchmarkIfEmpty(r: BenchmarkReport) { if (!getLastBenchmark()) setLastBenchmark(r); }
