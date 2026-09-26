import { Priority, FitnessWeights, ObjectiveTerms } from '../optimization/fitness';
import { AdaptiveTrace } from '../optimization/qpso/types';

export type DataSource = 'LIVE' | 'SIMULATED' | 'PREDICTED' | 'FALLBACK';

export interface Delivery {
  id: string; label: string; lat: number; lon: number; nodeId: string;
  demand: number; windowStart: number; windowEnd: number; serviceMin: number; priority: Priority;
  status: 'PENDING' | 'ASSIGNED' | 'COMPLETED' | 'FAILED';
}

export interface OpsVehicle {
  id: string; name: string; capacity: number;
  fuelType: 'petrol' | 'diesel' | 'electric' | 'cng'; fuelEfficiencyKmPerL: number; priority: Priority;
  available: boolean; status: 'ACTIVE' | 'BROKEN_DOWN' | 'UNAVAILABLE'; note?: string;
}

export type TwinEventType = 'TRAFFIC_INCREASE' | 'ROAD_CLOSURE' | 'ACCIDENT' | 'VEHICLE_BREAKDOWN' | 'VEHICLE_UNAVAILABLE' | 'WEATHER_CHANGE';
export const TWIN_EVENT_TYPES: TwinEventType[] = ['TRAFFIC_INCREASE', 'ROAD_CLOSURE', 'ACCIDENT', 'VEHICLE_BREAKDOWN', 'VEHICLE_UNAVAILABLE', 'WEATHER_CHANGE'];
export type WeatherCondition = 'Clear Sky' | 'Light Rain' | 'Heavy Rain' | 'Dense Fog' | 'Storm';

export interface EventRequest {
  type: TwinEventType;
  /** edge id, road code (R-142) or road name — for ROAD_CLOSURE / ACCIDENT / (optionally) TRAFFIC_INCREASE */
  road?: string;
  vehicleId?: string;
  percent?: number;                 // TRAFFIC_INCREASE: +% travel time on affected edges
  condition?: WeatherCondition;     // WEATHER_CHANGE
  /** TRAFFIC_INCREASE scope: 'ALL' (whole network) | 'MAJOR' (arterial+highway) | 'ROAD' (road param) */
  scope?: 'ALL' | 'MAJOR' | 'ROAD';
  note?: string;
}

export interface TwinEvent {
  id: string; at: string; request: EventRequest; description: string;
  affectedEdgeIds: string[]; affectedRoadNames: string[]; affectedVehicleIds: string[];
  networkWide: boolean;
  /** map position of the affected road (for the UI); absent for network-wide / vehicle events */
  location?: { lat: number; lon: number }; twinVersion: number; source: DataSource;
}

export interface PlanStop {
  deliveryId: string; label: string; nodeId: string;
  arrival: number; serviceStart: number; waiting: number; lateness: number; windowStart: number; windowEnd: number;
}

export interface PlanRoute {
  vehicleId: string; stops: PlanStop[]; order: string[]; nodePath: string[]; edgePath: string[];
  distanceKm: number; durationMin: number; totalTimeMin: number; fuelCostInr: number; co2Kg: number; riskScore: number;
  load: number; capacity: number; latenessMin: number; lateStops: number;
  geometry?: { lat: number; lon: number }[]; geometrySource?: string; steps?: RouteStep[];
}

export interface RouteStep {
  index: number; instruction: string;
  maneuver: 'depart' | 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'uturn' | 'arrive' | 'stop' | 'roundabout' | 'merge' | 'fork';
  roadName: string; distanceKm: number; durationMin: number; location: { lat: number; lon: number };
}

export interface PlanTotals {
  distanceKm: number; durationMin: number; totalTimeMin: number; fuelCostInr: number; co2Kg: number; riskScore: number;
  latenessMin: number; lateStops: number; makespanMin: number;
}

export interface Plan {
  id: string; createdAt: string; algorithm: string; seed: number; parameters: Record<string, number | string | boolean>;
  dataset: { label: string; fingerprint: string; customers: number; vehicles: number; depotId: string; startTimeMin: number };
  weights: FitnessWeights; fitness: number; terms: ObjectiveTerms; totals: PlanTotals;
  feasible: boolean; violations: { code: string; message: string }[]; unassigned: string[];
  routes: PlanRoute[]; convergence: number[]; evaluations: number; iterations: number; runtimeSeconds: number;
  adaptive?: Pick<AdaptiveTrace, 'betaHistory' | 'diversityHistory' | 'explorationHistory' | 'exploitationHistory' | 'stagnationHistory' | 'adaptiveHistory' | 'restarts'>;
  dnaId: string; twinVersion: number; scenario: string; source: DataSource;
}

export interface PlanSpec { routes: { vehicleId: string; deliveryIds: string[] }[]; }
export function specOf(plan: Plan): PlanSpec {
  return { routes: plan.routes.map((r) => ({ vehicleId: r.vehicleId, deliveryIds: r.stops.map((s) => s.deliveryId) })) };
}
export const MISSED_DELIVERY_MINUTES = 60;   // documented SLA charge for an unserved delivery
