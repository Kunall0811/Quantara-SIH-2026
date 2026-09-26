# QPSO, Adaptive QPSO, and why this is not quantum computing

## QPSO (Quantum-behaved Particle Swarm Optimization)

Classical PSO moves particles using position, velocity, a personal best and a global best. QPSO
(Sun, Feng & Xu, 2004) removes the velocity term entirely: each particle's next position is sampled
from a probability distribution (a "quantum delta potential well" analogy) centred on a stochastic
attractor point between its personal best and the swarm's global best, contracted or expanded by a
single coefficient **β** (`optimization/qpso/QPSO.ts`). It borrows the *mathematical form* of a quantum
wavefunction's position-probability distribution — nothing more. It runs as ordinary floating-point
arithmetic on an ordinary CPU core; there is no qubit, no superposition of actual computation, and no
quantum hardware anywhere in this codebase.

## Adaptive QPSO

`optimization/qpso/AdaptiveQPSO.ts` adjusts β every iteration from two **measured** signals of the
current swarm:
- **Diversity** — mean pairwise distance of particles from the swarm centroid (`swarmDiversity` in
  `objective.ts`).
- **Stagnation** — iterations since the global best last improved.

When stagnation is high and diversity is low, the worst-performing particles are re-seeded (a
"diversity restart") instead of continuing to converge on a possibly-local optimum. Every restart, and
the β/diversity/exploration/exploitation history, is recorded and surfaced in the API response and in
the Digital Twin / SIH demo UI — nothing about "adaptiveness" is asserted without the numbers to back it.

## Objective function (shared by every algorithm)

All six algorithms (QPSO, AQPSO, PSO, GA, SA, EXACT) minimise the *same* weighted objective
(`optimization/fitness.ts`): distance, travel time, traffic delay, fuel cost, road risk, weather
penalty, and turn count, plus penalties for unreachable legs, capacity violations, time-window
violations and unassigned deliveries. The seven positive terms plus the penalty term always sum exactly
to the reported fitness — this identity is asserted in `tests/twin.test.ts` and exposed via
`POST /api/advanced/explain`.

## What none of this is

- Not quantum computing: no quantum processor, simulator of quantum circuits, or qubit register exists
  in this codebase.
- Not a claim of provable global optimality except for `EXACT`, which is a genuine exhaustive search and
  is therefore restricted to ≤ 9 deliveries (`EXACT_MAX_CUSTOMERS`) — beyond that, permutations grow
  factorially and the system refuses to run it rather than approximate silently.
