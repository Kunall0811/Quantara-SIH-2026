/**
 * Multi-objective fitness for routing / VRP:
 *
 *   F = w1*Distance + w2*TravelTime + w3*Traffic + w4*FuelCost
 *     + w5*Risk + w6*Weather + w7*Turns + Penalty
 *
 *   Penalty = 5000 * unreachable legs + 10000 * unassigned customers
 *           + Σ_stops priorityWeight * (LATE_PER_MIN * lateness + LATE_FLAT * [lateness>0])
 *
 * Distance / time / traffic / risk come from the traffic-aware RoadGraph
 * (Dijkstra/A* on live edge speeds). Nothing here is a pre-baked number.
 * Time windows are scheduled explicitly: arrival → wait until readyTime →
 * service → depart, so lateness is a real, optimizable quantity.
 */
import { RoadGraph } from './graph';
import { RouteOracle } from './routeOracle';

export interface FitnessWeights {
  distance: number; travelTime: number; traffic: number; fuelCost: number; risk: number; weather: number; turns: number;
}

export const DEFAULT_WEIGHTS: FitnessWeights = {
  distance: 0.2, travelTime: 0.25, traffic: 0.2, fuelCost: 0.15, risk: 0.1, weather: 0.05, turns: 0.05,
};

/** Time-window soft-penalty constants (documented in docs/VRP.md). */
export const TW_LATE_PER_MIN = 1.0;
export const TW_LATE_FLAT = 25;
export const UNREACHABLE_PENALTY = 5000;
export const UNASSIGNED_PENALTY = 10000;

export type Priority = 'normal' | 'high' | 'emergency';
export const PRIORITY_WEIGHT: Record<Priority, number> = { normal: 1, high: 2, emergency: 3 };

export interface Customer {
  id: string;
  /** Graph node used by the VRP decoder. Kept optional for legacy callers. */
  nodeId?: string;
  demand: number;
  readyTime: number;   // minutes from 00:00
  dueTime: number;     // minutes from 00:00
  serviceTime: number; // minutes
  priority?: Priority;
  /** minimal-disruption re-planning: keep this delivery on this vehicle while that vehicle is available */
  pinnedVehicleId?: string;
}

export interface VehicleProfileLite {
  id?: string;
  fuelEfficiencyKmPerL: number; // km per litre (km per kWh for EV, km per kg for CNG)
  fuelType: 'petrol' | 'diesel' | 'electric' | 'cng';
  priority: Priority;
  capacity?: number;
  /** false ⇒ vehicle is broken down / unavailable and receives no customers. */
  available?: boolean;
}

export const FUEL_PRICE_INR: Record<string, number> = { petrol: 103, diesel: 96, cng: 85, electric: 8.5 };
/** kg CO2 per litre (petrol 2.31, diesel 2.68), per kg CNG (2.75), per kWh electric (India grid ≈ 0.71, CEA). */
export const CO2_KG_PER_UNIT: Record<string, number> = { petrol: 2.31, diesel: 2.68, cng: 2.75, electric: 0.71 };

export function estimateCo2Kg(distanceKm: number, v: Pick<VehicleProfileLite, 'fuelEfficiencyKmPerL' | 'fuelType'>): number {
  const units = distanceKm / Math.max(1, v.fuelEfficiencyKmPerL);
  return units * (CO2_KG_PER_UNIT[v.fuelType] ?? 2.3);
}

export interface WeatherContext { rainMm: number; weatherSeverity: number; }

export interface StopSpec {
  customerId?: string;
  readyTime: number; dueTime: number; serviceTime: number;
  priorityWeight?: number;
}
export interface StopTiming {
  index: number; nodeId: string; customerId?: string;
  arrival: number; serviceStart: number; waiting: number; lateness: number;
  windowStart: number; windowEnd: number;
}
export interface EvalOptions { oracle?: RouteOracle; stops?: (StopSpec | null)[]; }

export interface ObjectiveTerms {
  distance: number; travelTime: number; traffic: number; fuelCost: number; risk: number; weather: number; turns: number; penalty: number;
}
export const ZERO_TERMS: ObjectiveTerms = { distance: 0, travelTime: 0, traffic: 0, fuelCost: 0, risk: 0, weather: 0, turns: 0, penalty: 0 };
export function addTerms(a: ObjectiveTerms, b: ObjectiveTerms): ObjectiveTerms {
  return { distance: a.distance + b.distance, travelTime: a.travelTime + b.travelTime, traffic: a.traffic + b.traffic, fuelCost: a.fuelCost + b.fuelCost, risk: a.risk + b.risk, weather: a.weather + b.weather, turns: a.turns + b.turns, penalty: a.penalty + b.penalty };
}

export interface RouteEvaluation {
  fitness: number;
  terms: ObjectiveTerms;   // Σ terms === fitness (exact decomposition)
  distanceKm: number;
  durationMin: number;        // pure travel time
  trafficDelayMin: number;
  avgCongestion: number;
  fuelCostInr: number;
  co2Kg: number;
  riskScore: number;
  turns: number;
  nodePath: string[];
  edgePath: string[];
  penalty: number;
  unreachableSegments: number;
  arrivalTimes?: number[];    // service-start time at each node of the order
  stopDetails?: StopTiming[];
  latenessMin?: number;
  lateStops?: number;
  waitingMin?: number;
  totalTimeMin?: number;      // travel + waiting + service
  endTime?: number;
}

export interface VrpRouteDetail {
  vehicleId: string;
  order: string[];            // node ids: [depot, C1.nodeId, ..., depot]
  customerIds: string[];
  distanceKm: number;
  durationMin: number;
  totalTimeMin: number;
  arrivalTimes: number[];
  load: number;
  fuelCostInr: number;
  co2Kg: number;
  riskScore: number;
  nodePath: string[];
  edgePath: string[];
  stopDetails: StopTiming[];
  latenessMin: number;
  lateStops: number;
  terms: ObjectiveTerms;
  fitness: number;
  avgCongestion: number;
  trafficDelayMin: number;
  turns: number;
}

export interface VrpEvaluation {
  fitness: number;
  terms: ObjectiveTerms;
  distanceKm: number;
  durationMin: number;
  fuelCostInr: number;
  co2Kg: number;
  riskScore: number;
  trafficDelayMin: number;
  avgCongestion: number;
  penalty: number;
  unreachableSegments: number;
  latenessMin: number;
  lateStops: number;
  routes: VrpRouteDetail[];
  unassigned: string[];
  feasible?: boolean;
  constraintViolations?: { code: string; message: string }[];
}

/** Evaluates one fixed visiting order (list of node ids: origin ... waypoints ... destination). */
export function evaluateOrder(
  graph: RoadGraph,
  nodeOrder: string[],
  weights: FitnessWeights,
  vehicle: VehicleProfileLite,
  weather: WeatherContext,
  algo: 'dijkstra' | 'astar' = 'dijkstra',
  startTime: number = 0,
  opts: EvalOptions = {},
): RouteEvaluation {
  const oracle = opts.oracle ?? new RouteOracle(graph);
  let distanceKm = 0, freeFlowMin = 0, durationMin = 0, congestionSum = 0, congestionCount = 0;
  let turns = 0, riskSum = 0, riskCount = 0, unreachableSegments = 0;
  const fullNodePath: string[] = [];
  const fullEdgePath: string[] = [];
  const arrivalTimes: number[] = [startTime];
  const stopDetails: StopTiming[] = [];
  let clock = startTime, waitingMin = 0, latenessMin = 0, lateStops = 0, twPenalty = 0;
  let prevEdge: string | null = null;

  for (let i = 0; i < nodeOrder.length - 1; i++) {
    const leg = oracle.leg(nodeOrder[i], nodeOrder[i + 1], algo);
    let legCost = 0;
    if (!leg.reachable) {
      unreachableSegments += 1;             // genuinely disconnected / closed
    } else {
      legCost = leg.cost;                   // src === dst ⇒ valid zero-length leg
      durationMin += leg.cost;
      distanceKm += leg.distanceKm;
      freeFlowMin += leg.freeFlowMin;
      congestionSum += leg.congestionSum; congestionCount += leg.edgeCount;
      riskSum += leg.riskSum; riskCount += leg.edgeCount;
      for (const eid of leg.edgePath) {
        fullEdgePath.push(eid);
        if (prevEdge && prevEdge !== eid) turns += 1;
        prevEdge = eid;
      }
      fullNodePath.push(...(fullNodePath.length ? leg.nodePath.slice(1) : leg.nodePath));
    }
    const arrival = clock + legCost;
    const spec = opts.stops?.[i + 1] ?? null;
    if (spec) {
      const serviceStart = Math.max(arrival, spec.readyTime);
      const waiting = serviceStart - arrival;
      const lateness = Math.max(0, serviceStart - spec.dueTime);
      waitingMin += waiting;
      if (lateness > 0) {
        latenessMin += lateness; lateStops += 1;
        twPenalty += (spec.priorityWeight ?? 1) * (TW_LATE_PER_MIN * lateness + TW_LATE_FLAT);
      }
      stopDetails.push({ index: i + 1, nodeId: nodeOrder[i + 1], customerId: spec.customerId, arrival, serviceStart, waiting, lateness, windowStart: spec.readyTime, windowEnd: spec.dueTime });
      arrivalTimes.push(serviceStart);
      clock = serviceStart + spec.serviceTime;
    } else {
      arrivalTimes.push(arrival);
      clock = arrival;
    }
  }

  const avgCongestion = congestionCount ? congestionSum / congestionCount : 0;
  const avgRisk = riskCount ? riskSum / riskCount : 0.1;
  const trafficDelayMin = Math.max(0, durationMin - freeFlowMin);
  const priceInr = FUEL_PRICE_INR[vehicle.fuelType] ?? 100;
  const fuelCostInr = (distanceKm / Math.max(1, vehicle.fuelEfficiencyKmPerL)) * priceInr;
  const co2Kg = estimateCo2Kg(distanceKm, vehicle);
  const priorityDiscount = vehicle.priority === 'emergency' ? 0.5 : vehicle.priority === 'high' ? 0.8 : 1.0;

  const penalty = unreachableSegments * UNREACHABLE_PENALTY + twPenalty;
  const terms: ObjectiveTerms = {
    distance: weights.distance * distanceKm,
    travelTime: weights.travelTime * durationMin * priorityDiscount,
    traffic: weights.traffic * avgCongestion * 100,
    fuelCost: weights.fuelCost * fuelCostInr * 0.1,
    risk: weights.risk * avgRisk * 100,
    weather: weights.weather * weather.weatherSeverity * 50,
    turns: weights.turns * turns,
    penalty,
  };
  const fitness = terms.distance + terms.travelTime + terms.traffic + terms.fuelCost + terms.risk + terms.weather + terms.turns + terms.penalty;

  return {
    fitness, terms, distanceKm, durationMin, trafficDelayMin, avgCongestion, fuelCostInr, co2Kg,
    riskScore: avgRisk, turns, nodePath: fullNodePath, edgePath: fullEdgePath, penalty, unreachableSegments,
    arrivalTimes, stopDetails, latenessMin, lateStops, waitingMin,
    totalTimeMin: clock - startTime, endTime: clock,
  };
}

export function normalizedTrafficLevel(congestionPct: number): 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' {
  if (congestionPct >= 0.7) return 'SEVERE';
  if (congestionPct >= 0.45) return 'HIGH';
  if (congestionPct >= 0.2) return 'MODERATE';
  return 'LOW';
}
