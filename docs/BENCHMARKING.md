# Benchmarking & Scalability

## Benchmark engine (`backend/src/optimization/benchmarkEngine.ts`)

- **Fixed seeds**: `[42, 123, 456, 789, 1001]` — every algorithm sees the identical generated dataset
  and the identical initial swarm/population per seed (`tests/optimization.test.ts` asserts population
  methods share the same iteration-1 best).
- **Equal evaluation budget**: population size × max iterations is the same for every algorithm in a
  run, recorded in `meta.evaluationBudget`.
- **EXACT** is only included when the instance is ≤ 9 customers (`EXACT_MAX_CUSTOMERS`); otherwise it is
  listed under `meta.algorithmsSkipped` with a stated reason, never silently dropped.
- **Significance**: every metaheuristic is compared against QPSO with a Mann-Whitney U test
  (`vsQPSO: { pValue, verdict, meanDiffPct }`) — "better"/"worse"/"indistinguishable" is a statistical
  verdict, not a marketing claim, and non-significant results are reported as indistinguishable.
- **Hardware & fairness metadata**: CPU model, core count, and a `fairness` string list documenting the
  protocol (shared dataset, shared budget, shared RNG seed per run) ship with every report.
- The most recent report is persisted (`optimization/benchmarkStore.ts`) so the Advanced Lab, FRIDAY and
  the SIH demo can all cite the same numbers instead of re-running silently different configurations.

## Scalability test (`backend/src/controllers/scalabilityController.ts`)

Runs the real optimizer at N = 10, 25, 50, 100, 250, 500 (configurable). Every row is either:
- `MEASURED` — an actual run, with wall-clock runtime, evaluations, heap delta, and solution quality, or
- `NOT EXECUTED` — when the runtime extrapolated from the previous measured size (super-linear,
  exponent 1.3) exceeds the configured per-run budget. The predicted runtime and the reasoning are
  reported; no number is fabricated for a size that was not actually run.

EXACT is never run above `EXACT_MAX_CUSTOMERS` regardless of the requested sizes, because permutations
grow factorially.
