import { RoadGraph } from './graph';
import { RouteOracle } from './routeOracle';
import {
  addTerms, ZERO_TERMS, ObjectiveTerms, evaluateOrder, FitnessWeights, VehicleProfileLite, WeatherContext, RouteEvaluation, Customer,
  VrpEvaluation, VrpRouteDetail, StopSpec, PRIORITY_WEIGHT, UNASSIGNED_PENALTY,
} from './fitness';

/**
 * Random-key decoding: a real-valued priority vector (one key per waypoint /
 * customer) is turned into a concrete visiting order by argsort — the standard
 * random-key encoding for permutation problems.
 */
export function decodeOrder(position: number[], waypointIds: string[]): string[] {
  const idx = waypointIds.map((_, i) => i);
  idx.sort((a, b) => position[a] - position[b] || a - b);
  return idx.map((i) => waypointIds[i]);
}

export function evaluatePosition(
  position: number[],
  graph: RoadGraph,
  originId: string,
  destinationId: string,
  waypointIds: string[],
  weights: FitnessWeights,
  vehicle: VehicleProfileLite,
  weather: WeatherContext,
  algo: 'dijkstra' | 'astar' = 'dijkstra',
  oracle?: RouteOracle,
): RouteEvaluation & { order: string[] } {
  const orderedWaypoints = waypointIds.length ? decodeOrder(position, waypointIds) : [];
  const fullOrder = [originId, ...orderedWaypoints, destinationId];
  const evaluation = evaluateOrder(graph, fullOrder, weights, vehicle, weather, algo, 0, { oracle });
  return { ...evaluation, order: fullOrder };
}

export function decodeVrpOrder(position: number[], customers: Customer[]): Customer[] {
  const idx = customers.map((_, i) => i);
  idx.sort((a, b) => position[a] - position[b] || a - b);
  return idx.map((i) => customers[i]);
}

interface RouteBuild {
  vehicleIndex: number; vehicleId: string;
  order: string[]; customers: Customer[]; load: number; clock: number; last: string;
}

/**
 * VRP decoding ("giant tour + capacity/time-window aware split"):
 *   1. argsort the position vector → giant tour of customers
 *   2. walk the tour; for each customer try vehicles cyclically starting from
 *      the vehicle that served the previous customer (first-fit):
 *        - skip unavailable vehicles (breakdown)
 *        - skip vehicles whose remaining capacity < demand
 *        - prefer the first vehicle that can reach the customer inside its window
 *        - otherwise take the least-late capacity-feasible vehicle (soft penalty)
 *        - if no vehicle has capacity: customer is UNASSIGNED (10 000 penalty)
 *   3. close every non-empty route back to the depot and evaluate it exactly
 * Deterministic: depends only on (position, problem instance).
 */
export function evaluateVrpPosition(
  position: number[],
  graph: RoadGraph,
  depotId: string,
  customers: Customer[],
  fleet: VehicleProfileLite[],
  weights: FitnessWeights,
  weather: WeatherContext,
  algo: 'dijkstra' | 'astar' = 'dijkstra',
  startTime: number = 0,
  oracle?: RouteOracle,
): VrpEvaluation {
  const orc = oracle ?? new RouteOracle(graph);
  const ordered = customers.length ? decodeVrpOrder(position, customers) : [];
  const builds: RouteBuild[] = fleet.map((v, i) => ({
    vehicleIndex: i, vehicleId: v.id || `V-${String(i + 1).padStart(2, '0')}`,
    order: [depotId], customers: [], load: 0, clock: startTime, last: depotId,
  }));
  const unassigned: string[] = [];
  let cursor = 0;

  for (const c of ordered) {
    if (!c.nodeId) { unassigned.push(c.id); continue; }
    let chosen = -1, chosenLate = Infinity, chosenIsFeasible = false, capacityOnly = -1;
    for (let k = 0; k < fleet.length; k++) {
      const vi = (cursor + k) % fleet.length;
      const v = fleet[vi];
      if (v.available === false) continue;
      if (c.pinnedVehicleId && c.pinnedVehicleId !== v.id && fleet.some((f) => f.id === c.pinnedVehicleId && f.available !== false)) continue;   // pinned to a healthy vehicle
      const b = builds[vi];
      if (b.load + c.demand > (v.capacity ?? Infinity)) continue;
      if (capacityOnly < 0) capacityOnly = vi;
      const leg = orc.leg(b.last, c.nodeId, algo);
      if (!leg.reachable) continue;
      const start = Math.max(b.clock + leg.cost, c.readyTime);
      const late = Math.max(0, start - c.dueTime);
      if (late === 0) { chosen = vi; chosenIsFeasible = true; break; }
      if (late < chosenLate) { chosenLate = late; chosen = vi; }
    }
    if (chosen < 0) chosen = capacityOnly;      // unreachable everywhere → still capacity-assign so the penalty shows
    if (chosen < 0) { unassigned.push(c.id); continue; }
    const b = builds[chosen];
    const leg = orc.leg(b.last, c.nodeId, algo);
    const arrival = b.clock + (leg.reachable ? leg.cost : 0);
    const start = Math.max(arrival, c.readyTime);
    b.order.push(c.nodeId); b.customers.push(c); b.load += c.demand;
    b.clock = start + c.serviceTime; b.last = c.nodeId; cursor = chosen;
    void chosenIsFeasible;
  }

  return assembleVrp(builds, unassigned, graph, depotId, fleet, weights, weather, algo, startTime, orc);
}

function assembleVrp(
  builds: RouteBuild[], unassigned: string[], graph: RoadGraph, depotId: string, fleet: VehicleProfileLite[],
  weights: FitnessWeights, weather: WeatherContext, algo: 'dijkstra' | 'astar', startTime: number, orc: RouteOracle,
): VrpEvaluation {
  const routes: VrpRouteDetail[] = [];
  let totalFitness = 0, totalDistance = 0, totalDuration = 0, totalTrafficDelay = 0, totalCongestion = 0;
  let totalFuel = 0, totalCo2 = 0, totalRisk = 0, totalUnreachable = 0, totalPenalty = 0, totalLate = 0, totalLateStops = 0;
  let active = 0;
  let terms: ObjectiveTerms = { ...ZERO_TERMS };

  for (const b of builds) {
    if (!b.customers.length) continue;
    b.order.push(depotId);
    const v = fleet[b.vehicleIndex];
    const stops: (StopSpec | null)[] = [null, ...b.customers.map((c) => ({
      customerId: c.id, readyTime: c.readyTime, dueTime: c.dueTime, serviceTime: c.serviceTime,
      priorityWeight: PRIORITY_WEIGHT[c.priority ?? 'normal'],
    })), null];
    const ev = evaluateOrder(graph, b.order, weights, v, weather, algo, startTime, { oracle: orc, stops });
    routes.push({
      vehicleId: b.vehicleId, order: b.order, customerIds: b.customers.map((c) => c.id),
      distanceKm: ev.distanceKm, durationMin: ev.durationMin, totalTimeMin: ev.totalTimeMin ?? ev.durationMin,
      arrivalTimes: ev.arrivalTimes ?? [], load: b.load, fuelCostInr: ev.fuelCostInr, co2Kg: ev.co2Kg,
      riskScore: ev.riskScore, nodePath: ev.nodePath, edgePath: ev.edgePath, stopDetails: ev.stopDetails ?? [],
      latenessMin: ev.latenessMin ?? 0, lateStops: ev.lateStops ?? 0,
      terms: ev.terms, fitness: ev.fitness, avgCongestion: ev.avgCongestion, trafficDelayMin: ev.trafficDelayMin, turns: ev.turns,
    });
    terms = addTerms(terms, ev.terms);
    totalFitness += ev.fitness; totalDistance += ev.distanceKm; totalDuration += ev.durationMin;
    totalTrafficDelay += ev.trafficDelayMin; totalCongestion += ev.avgCongestion; totalFuel += ev.fuelCostInr;
    totalCo2 += ev.co2Kg; totalRisk += ev.riskScore; totalUnreachable += ev.unreachableSegments;
    totalPenalty += ev.penalty; totalLate += ev.latenessMin ?? 0; totalLateStops += ev.lateStops ?? 0;
    active++;
  }
  if (active > 0) { totalCongestion /= active; totalRisk /= active; }
  const unassignedPenalty = unassigned.length * UNASSIGNED_PENALTY;
  terms = { ...terms, penalty: terms.penalty + unassignedPenalty };

  return {
    fitness: totalFitness + unassignedPenalty,            // route penalties are already inside route fitness
    terms,
    distanceKm: totalDistance, durationMin: totalDuration, trafficDelayMin: totalTrafficDelay,
    avgCongestion: totalCongestion, fuelCostInr: totalFuel, co2Kg: totalCo2, riskScore: totalRisk,
    penalty: totalPenalty + unassignedPenalty, unreachableSegments: totalUnreachable,
    latenessMin: totalLate, lateStops: totalLateStops, routes, unassigned,
    feasible: unassigned.length === 0 && totalUnreachable === 0 && totalLateStops === 0,
    constraintViolations: unassigned.length
      ? [{ code: 'C4', message: `${unassigned.length} customer(s) unassigned due to capacity / fleet availability: ${unassigned.join(', ')}` }]
      : [],
  };
}

/**
 * Evaluate a FIXED plan (vehicle → ordered customer ids) on a graph. Used by the
 * scenario engine to answer "what happens to the plan we already committed to if
 * the network changes?" — no re-optimisation, no re-assignment, just re-simulation.
 * Customers missing from the spec are reported as unassigned.
 */
export function evaluateFixedPlan(
  spec: Record<string, string[]>,
  graph: RoadGraph, depotId: string, customers: Customer[], fleet: VehicleProfileLite[],
  weights: FitnessWeights, weather: WeatherContext, algo: 'dijkstra' | 'astar' = 'dijkstra',
  startTime = 0, oracle?: RouteOracle,
): VrpEvaluation {
  const orc = oracle ?? new RouteOracle(graph);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const builds: RouteBuild[] = fleet.map((v, i) => {
    const vehicleId = v.id || `V-${String(i + 1).padStart(2, '0')}`;
    const list = (spec[vehicleId] || []).map((id) => byId.get(id)).filter((c): c is Customer => !!c && !!c.nodeId);
    const order = [depotId, ...list.map((c) => c.nodeId!)];
    list.forEach((c) => seen.add(c.id));
    return { vehicleIndex: i, vehicleId, order, customers: list, load: list.reduce((s, c) => s + c.demand, 0), clock: startTime, last: depotId };
  });
  // a broken-down vehicle cannot serve its customers → they become unassigned in the fixed plan
  const unassigned: string[] = customers.filter((c) => !seen.has(c.id)).map((c) => c.id);
  builds.forEach((b) => {
    if (fleet[b.vehicleIndex].available === false && b.customers.length) {
      unassigned.push(...b.customers.map((c) => c.id)); b.customers = []; b.order = [depotId]; b.load = 0;
    }
  });
  return assembleVrp(builds, unassigned, graph, depotId, fleet, weights, weather, algo, startTime, orc);
}
