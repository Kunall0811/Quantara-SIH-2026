# Architecture

## Chain of custody: Digital Twin → Graph → Optimization → Route → Fleet → UI

```
backend/src/data/indiaGraph.ts      Pune-centred road graph: 78 junctions, 176 named roads (352
                                     directed edges incl. reverse edges), each with distance, base
                                     speed, road type and a risk score.
        │
backend/src/services/graphService.ts  The live, mutable copy of that graph. Traffic drift, weather
                                     and admin edits all mutate THIS object. Deterministic (seeded
                                     by TWIN_SEED) so demos reproduce.
        │
backend/src/twin/engine.ts (TwinEngine, singleton `twin`)
        Holds: the live graph, fleet, deliveries, event log, plan history.
        .load()      → generates a seeded delivery/fleet dataset on the graph
        .optimize()  → calls the algorithm registry, builds a Plan, stores it
        .applyEvent()→ mutates the live graph/fleet (closures, accidents, traffic,
                       breakdowns, weather), computes Impact by re-simulating the
                       committed plan on the changed network
        .reoptimize()→ re-runs the optimizer, by default in MINIMAL mode (only
                       deliveries on affected/broken vehicles may change driver)
        │
backend/src/optimization/index.ts (runAlgorithm registry)
        QPSO | AQPSO | PSO | GA | SA | EXACT, all built on the same
        optimization/qpso/objective.ts (createObjective) and optimization/fitness.ts
        (exact term-by-term decomposition: distance, time, traffic, fuel, risk,
        weather, turns, penalty — these always sum exactly to the reported fitness).
        │
backend/src/optimization/waypointOrder.ts
        Decodes a candidate solution into per-vehicle routes with real
        Dijkstra/A* shortest paths (optimization/graph.ts, cached via
        optimization/routeOracle.ts), respecting time windows, capacity and
        (during minimal-disruption re-planning) delivery→vehicle pins.
        │
backend/src/twin/plan.ts (buildPlan) + backend/src/twin/directions.ts (buildSteps)
        Turns the raw optimizer result into a Plan: per-route geometry, turn-by-turn
        steps (bearing/turn-angle based maneuver classification on the REAL edge
        sequence), objective terms, a reproducible "Route DNA" id (SHA-256 of
        algorithm+assignment+dataset fingerprint+seed+weights+fitness).
        │
backend/src/services/fleetTracker.ts
        POST /api/twin/dispatch pushes a Plan's stops to the live fleet simulation
        as real missions (position, speed, ETA all driven by the same graph).
        │
frontend/src/pages/DigitalTwin.tsx, SihDemo.tsx, AdvancedLab.tsx, Benchmarking.tsx, Scalability.tsx
        Render exactly what the API returns. No page invents a number; every value
        carries a source label (LIVE / SIMULATED / PREDICTED / FALLBACK / MEASURED).
```

## Scenario / resilience / regret / counterfactual (backend/src/twin/analytics.ts)

Every one of these clones the live twin's graph and fleet (`buildWorld`), applies the requested
event(s) with the SAME mutation code the live twin uses (`twin/mutate.ts` — shared, not duplicated),
then either re-simulates the committed plan unchanged or re-runs the optimizer on the clone. The live
twin is never touched by an analysis call; `tests/twin.test.ts` asserts this with a before/after graph
snapshot comparison.

- **Resilience** = mean(1 if the plan survives a scenario unchanged; 0.5 if only re-optimization
  recovers it; 0 otherwise) × 100, over a battery of six scenarios (accident, closure, +50% traffic,
  heavy rain, vehicle failure, and a no-op baseline).
- **Regret** = fitness(selected plan under a scenario) − min(fitness of every other stored plan for the
  same dataset, fitness of a hindsight re-optimization), reported in both the optimizer's own fitness
  units and in operational minutes.
- **Counterfactual** = WITHOUT re-optimization vs WITH re-optimization, same scenario, same clone.
- **Time-window risk** reads real `StopTiming` data (arrival, service start, slack) from the plan; it
  does not estimate lateness from aggregate statistics.

## Data flow honesty

Every API response that could be mistaken for live/measured data carries an explicit label:
`LIVE`, `SIMULATED`, `PREDICTED`, `FALLBACK`, or `MEASURED`. The frontend's `SourceBadge` component
renders this directly from the API field — it is never hard-coded per page.
