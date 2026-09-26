# Digital Twin

`backend/src/twin/engine.ts` — a single `TwinEngine` instance (`twin`) is the source of truth for one
"session" of the platform: the live road graph, the fleet, the deliveries, the applied-event log, and
every plan ever computed against them.

## State

| Field | What it is |
|---|---|
| `graph` | The live, mutable `RoadGraph` (delegates to `services/graphService.ts`) |
| `fleet` | Vehicles with capacity, fuel type/efficiency, availability, status |
| `deliveries` | Demand, time window, priority, service time, current status |
| `events` | Every `TwinEvent` applied, with description, affected roads/vehicles, twin version |
| `plans` | Every `Plan` produced by `optimize()`, newest last, capped at 60 |
| `affectedSincePlan` | Vehicles hit by an event since the last plan — drives minimal-disruption replanning |

## Event types

`ROAD_CLOSURE`, `ACCIDENT`, `TRAFFIC_INCREASE`, `VEHICLE_BREAKDOWN`, `VEHICLE_UNAVAILABLE`,
`WEATHER_CHANGE`. Mutation logic lives in `twin/mutate.ts` and is shared verbatim between the live twin
(`applyEvent`) and dry-run scenario analysis (`twin/analytics.ts:buildWorld`) — there is exactly one
implementation of "what a road closure does to the graph."

- `ROAD_CLOSURE` / `ACCIDENT` default to the busiest road on the current plan when no road is named.
- `ACCIDENT` also slows the roads feeding into the affected one (queue spillback), not just the road
  itself.
- The engine refuses to disable the last available vehicle rather than silently producing an
  unsolvable instance.

## Minimal-disruption re-planning

`reoptimize({ mode: 'MINIMAL' })` (the default) pins every delivery on a vehicle that was *not* hit by
an event to that same vehicle (`optimization/fitness.ts: Customer.pinnedVehicleId`, honoured by the
decoder in `optimization/waypointOrder.ts`). Only deliveries on affected or unavailable vehicles are
free to move to a different vehicle. `mode: 'FULL'` re-plans everything from scratch. Both modes are
exposed in the Digital Twin UI's Re-plan tab.

## Execution & learning

`POST /api/twin/execute` re-simulates the committed plan on the *current* network state and records the
predicted-vs-actual ETA gap per stop to the learning store (`learning/actualVsPredicted.ts`), labelled
`SIMULATED_EXECUTION` — never conflated with `MEASURED` field data. `POST /api/twin/dispatch` instead
pushes the plan to the live fleet-tracking simulation as real missions.
