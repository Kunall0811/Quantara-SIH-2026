import { getGraph } from './graphService';
import { haversineKm } from '../optimization/graph';
import { getIo } from '../socket';

export type FleetStatus = 'ON_ROUTE' | 'DELAYED' | 'IDLE' | 'OFFLINE';

export interface FleetVehicleLive {
  id: string;
  name: string;
  registration: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  status: FleetStatus;
  eta: string;
  etaMinutes: number;
  deliveries: number;
  completedDeliveries: number;
  nextStop: string;
  routeProgressPct: number;
  distanceRemainingKm: number;
  lastGpsAt: string;
  locationSource: 'GPS' | 'SIMULATION';
  confidencePct: number;
  matchedRoad: string;
  city: string;
  temperatureC: number | null;
  routeGeometry: { lat: number; lon: number }[];
  /** Multi-stop mission (section 4): when set, the vehicle is progressing
   *  through a real, ordered list of stops with automatic arrival detection
   *  and advancement — no manual map interaction required. */
  mission: MissionInfo | null;
}

export interface MissionStop { label: string; lat: number; lon: number; completed: boolean }
export interface MissionInfo { stops: MissionStop[]; currentIndex: number; active: boolean; startedAt: string }

interface InternalVehicle extends FleetVehicleLive {
  path: { lat: number; lon: number; road?: string }[];
  segment: number;
  segmentProgress: number;
  targetSpeed: number;
  lastTick: number;
  destinationIndex: number;
  /** Path-index breakpoints at which each mission stop is reached (geofence
   *  proxy: arriving at the graph node nearest the stop). */
  missionBreaks: number[];
  /** breakdown / unavailable: vehicle is stationary, excluded from planning, shown OFFLINE */
  offline?: boolean;
}

const VEHICLE_PLANS = [
  ['Q-01', 'QUANTARA-01', 'MH12 QN 0101', 0, 2, 4, 48],
  ['Q-02', 'QUANTARA-02', 'MH12 QN 0102', 1, 3, 5, 34],
  ['Q-03', 'QUANTARA-03', 'MH12 QN 0103', 2, 4, 3, 52],
  ['Q-04', 'QUANTARA-04', 'MH12 QN 0104', 3, 5, 4, 40],
  ['Q-05', 'QUANTARA-05', 'MH12 QN 0105', 4, 1, 4, 27],
  ['Q-06', 'QUANTARA-06', 'MH12 QN 0106', 5, 0, 3, 31],
] as const;

let vehicles: Map<string, InternalVehicle> | null = null;

function makePath(startArea: number, endArea: number) {
  const g = getGraph();
  const src = g.nearestNode([18.5912,18.5978,18.5590,18.5074,18.5010,18.5089][startArea], [73.7389,73.7645,73.7869,73.8077,73.8580,73.9260][startArea]);
  const dst = g.nearestNode([18.5912,18.5978,18.5590,18.5074,18.5010,18.5089][endArea], [73.7389,73.7645,73.7869,73.8077,73.8580,73.9260][endArea]);
  const result = g.shortest(src, dst, 'astar', 'time');
  if (!result.nodePath.length) return [{ lat: g.nodes.get(src)!.lat, lon: g.nodes.get(src)!.lon, road: undefined as string | undefined }];
  return result.nodePath.map((id, i) => ({ lat: g.nodes.get(id)!.lat, lon: g.nodes.get(id)!.lon, road: result.edgePath[i] ? g.edges.get(result.edgePath[i])?.name : undefined }));
}

/** Build one continuous, real-road path through an ordered list of stops by
 *  chaining A* shortest-path segments between each consecutive pair, so a
 *  multi-stop mission always follows actual roads (never a straight line)
 *  and never requires touching the map between stops. Returns the path plus
 *  the path-index at which each stop is reached. */
function buildChainedPath(points: { lat: number; lon: number }[]) {
  const g = getGraph();
  const path: { lat: number; lon: number; road?: string }[] = [];
  const breaks: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const src = g.nearestNode(points[i].lat, points[i].lon);
    const dst = g.nearestNode(points[i + 1].lat, points[i + 1].lon);
    const result = g.shortest(src, dst, 'astar', 'time');
    const leg: { lat: number; lon: number; road?: string }[] = result.nodePath.length
      ? result.nodePath.map((id, j) => ({ lat: g.nodes.get(id)!.lat, lon: g.nodes.get(id)!.lon, road: result.edgePath[j] ? g.edges.get(result.edgePath[j])?.name : undefined }))
      : [points[i], points[i + 1]];
    if (i === 0) path.push(...leg); else path.push(...leg.slice(1));
    breaks.push(path.length - 1);
  }
  return { path, breaks };
}

import { calculateRouteThrough, calculateRoute } from './routingManager';

/** Start (or replace) a real multi-stop mission for a vehicle. The vehicle
 *  automatically advances stop-to-stop as it arrives — no manual map
 *  interaction required (fixes section 4 / "multi-stop automatic
 *  navigation"). */
export async function startMission(id: string, stops: { label: string; lat: number; lon: number }[]) {
  init();
  let v = vehicles!.get(id);
  if (!v) {
     const depot = { lat: 18.5204, lon: 73.8567 };
     v = {
       id, name: `Custom Fleet ${id}`, registration: 'N/A', lat: depot.lat, lon: depot.lon, speed: 0, heading: 0,
       status: 'IDLE', eta: '--', etaMinutes: 0, deliveries: 0, completedDeliveries: 0,
       nextStop: 'Waiting for assignment', routeProgressPct: 0, distanceRemainingKm: 0, lastGpsAt: new Date().toISOString(),
       locationSource: 'SIMULATION', confidencePct: 100, matchedRoad: 'Depot', city: 'Pune', temperatureC: null,
       routeGeometry: [], mission: null, path: [depot], segment: 0, segmentProgress: 0, targetSpeed: 0, lastTick: Date.now(), destinationIndex: 0, missionBreaks: []
     };
     vehicles!.set(id, v);
  }
  if (stops.length < 1) return null;
  const points = [{ lat: v.lat, lon: v.lon }, ...stops];
  const route = await calculateRouteThrough(points);
  if (!route || !route.geometry || !route.geometry.length) return null;
  
  v.path = route.geometry.map(p => ({ lat: p.lat, lon: p.lon, road: 'Local Road' }));
  const breaks: number[] = [];
  let currentIdx = 0;
  for (let i = 0; i < (route.legs?.length || 0); i++) {
    // calculateRouteThrough leg i geometry length
    // Actually, calculateRouteThrough merges geometries. We can just find the nearest index for each stop.
    // Or we can just calculate breaks by accumulating leg distance/points.
    // Let's just find the nearest path index to each stop.
    let bestIdx = currentIdx, bestD = Infinity;
    for (let j = currentIdx; j < v.path.length; j++) {
      const d = haversineKm(stops[i].lat, stops[i].lon, v.path[j].lat, v.path[j].lon);
      if (d < bestD) { bestD = d; bestIdx = j; }
    }
    breaks.push(bestIdx);
    currentIdx = bestIdx;
  }
  
  v.missionBreaks = breaks;
  v.segment = 0;
  v.segmentProgress = 0;
  v.mission = { stops: stops.map((s) => ({ ...s, completed: false })), currentIndex: 0, active: true, startedAt: new Date().toISOString() };
  v.status = 'ON_ROUTE';
  v.routeGeometry = route.geometry.map(({ lat, lon }) => ({ lat, lon }));
  recalculateAll();
  const result = getFleetVehicle(id);
  getIo()?.emit('mission_update', { type: 'STARTED', vehicleId: id, vehicle: result });
  return result;
}

/** Mark a vehicle broken down / unavailable (twin VEHICLE_BREAKDOWN) or restore it. Cancels any active mission. */
export function setVehicleOffline(id: string, offline: boolean) {
  init();
  const v = vehicles!.get(id);
  if (!v) return null;
  v.offline = offline;
  if (offline) { if (v.mission) v.mission.active = false; v.speed = 0; v.targetSpeed = 0; }
  recalculateAll();
  getIo()?.emit('mission_update', { type: offline ? 'BREAKDOWN' : 'RESTORED', vehicleId: id, vehicle: getFleetVehicle(id) });
  return getFleetVehicle(id);
}

export function cancelMission(id: string) {
  init();
  const v = vehicles!.get(id);
  if (!v || !v.mission) return null;
  v.mission.active = false;
  getIo()?.emit('mission_update', { type: 'CANCELLED', vehicleId: id, vehicle: getFleetVehicle(id) });
  return getFleetVehicle(id);
}

function init() {
  if (vehicles) return;
  vehicles = new Map();
  VEHICLE_PLANS.forEach(([id, name, registration, start, end, deliveries, speed]) => {
    const path = makePath(start, end);
    const p = path[0];
    vehicles!.set(id, {
      id, name, registration, lat: p.lat, lon: p.lon, speed: 0, heading: 0,
      status: 'IDLE', eta: '--', etaMinutes: 0, deliveries: 0, completedDeliveries: 0,
      nextStop: 'Waiting for assignment', routeProgressPct: 0, distanceRemainingKm: 0,
      lastGpsAt: new Date().toISOString(), locationSource: 'SIMULATION', confidencePct: 100,
      matchedRoad: 'Depot', city: 'Pune', temperatureC: null, routeGeometry: [],
      mission: null,
      path: [p], segment: 0, segmentProgress: 0, targetSpeed: 0, lastTick: Date.now(), destinationIndex: start, missionBreaks: [],
    });
  });
}

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin((b.lon-a.lon)*Math.PI/180) * Math.cos(b.lat*Math.PI/180);
  const x = Math.cos(a.lat*Math.PI/180)*Math.sin(b.lat*Math.PI/180) - Math.sin(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.cos((b.lon-a.lon)*Math.PI/180);
  return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
}

function routeStats(v: InternalVehicle) {
  let remaining = 0, total = 0;
  for (let i = 0; i < v.path.length - 1; i++) {
    const d = haversineKm(v.path[i].lat, v.path[i].lon, v.path[i+1].lat, v.path[i+1].lon);
    total += d;
    if (i >= v.segment) remaining += d;
  }
  if (v.segment < v.path.length - 1) {
    const seg = haversineKm(v.path[v.segment].lat, v.path[v.segment].lon, v.path[v.segment+1].lat, v.path[v.segment+1].lon);
    remaining -= seg * Math.min(1, v.segmentProgress);
  }
  const progress = total > 0 ? Math.max(0, Math.min(100, ((total-remaining)/total)*100)) : 100;
  return { remaining: Math.max(0, remaining), progress };
}

function recalculateAll() {
  init();
  vehicles!.forEach(v => {
    const stats = routeStats(v);
    v.distanceRemainingKm = Math.round(stats.remaining * 10) / 10;
    v.routeProgressPct = Math.round(stats.progress * 10) / 10;
    const eta = v.speed > 1 ? stats.remaining / v.speed * 60 : 999;
    v.etaMinutes = Math.round(eta * 10) / 10;
    v.eta = eta < 999 ? `${Math.floor(eta)}m ${Math.round((eta % 1)*60)}s` : '—';
    v.status = v.speed === 0 ? 'IDLE' : v.speed < 8 ? 'DELAYED' : 'ON_ROUTE';
    if (v.offline) v.status = 'OFFLINE';
  });
}

export function getFleetVehicles() {
  init();
  recalculateAll();
  return [...vehicles!.values()].map(({path, segment, segmentProgress, targetSpeed, lastTick, destinationIndex, missionBreaks, ...v}) => v);
}

export function getFleetVehicle(id: string) {
  init();
  recalculateAll();
  const v = vehicles!.get(id);
  if (!v) return null;
  const {path, segment, segmentProgress, targetSpeed, lastTick, destinationIndex, missionBreaks, ...publicV} = v;
  return publicV;
}

export function tickFleet(seconds = 2) {
  init();
  const now = Date.now();
  vehicles!.forEach(v => {
    const dt = Math.max(0.5, Math.min(5, seconds || (now-v.lastTick)/1000));
    if (v.offline) { v.speed = 0; v.targetSpeed = 0; v.lastTick = now; return; }
    const trafficFactor = 0.72 + Math.sin(now / 55000 + v.id.length) * 0.12;
    
    if (v.mission?.active) {
      v.targetSpeed = Math.max(12, v.targetSpeed * trafficFactor);
      v.speed += (v.targetSpeed - v.speed) * 0.18;
      let km = v.speed * dt / 3600;
      const prevSegment = v.segment;
      while (km > 0 && v.segment < v.path.length-1) {
        const a = v.path[v.segment], b = v.path[v.segment+1];
        const segKm = Math.max(0.01, haversineKm(a.lat,a.lon,b.lat,b.lon));
        const left = segKm * (1-v.segmentProgress);
        if (km >= left) { km -= left; v.segment++; v.segmentProgress = 0; }
        else { v.segmentProgress += km/segKm; km = 0; }
      }
      
      for (let si = v.mission.currentIndex; si < v.mission.stops.length; si++) {
        const bp = v.missionBreaks[si];
        if (bp !== undefined && v.segment >= bp && prevSegment < bp) {
          v.mission.stops[si].completed = true;
          v.mission.currentIndex = si + 1;
          v.completedDeliveries = Math.min(v.deliveries, v.completedDeliveries + 1);
          getIo()?.emit('mission_update', { type: 'STOP_REACHED', vehicleId: v.id, stopIndex: si, stop: v.mission.stops[si], vehicle: getFleetVehicle(v.id) });
        }
      }
      if (v.mission.currentIndex >= v.mission.stops.length && v.segment >= v.path.length - 1) {
        v.mission.active = false;
        v.targetSpeed = 0;
        v.speed = 0;
        getIo()?.emit('mission_update', { type: 'COMPLETED', vehicleId: v.id, vehicle: getFleetVehicle(v.id) });
      }
    } else {
      v.targetSpeed = 0;
      v.speed = 0;
    }
    const a = v.path[v.segment], b = v.path[Math.min(v.segment+1,v.path.length-1)];
    v.lat = a.lat + (b.lat-a.lat)*v.segmentProgress;
    v.lon = a.lon + (b.lon-a.lon)*v.segmentProgress;
    v.heading = bearing(a,b);
    v.matchedRoad = b.road || a.road || 'Local road';
    v.lastGpsAt = new Date().toISOString();
    v.locationSource = 'SIMULATION';
    v.confidencePct = 88 + (Math.abs(Math.round(Math.sin(now / 9000 + v.id.length) * 4.5)) + 4);   // deterministic function of time, not random
    v.lastTick = now;
    
    // GPS Anomaly detection -> Potential Incident
    if (v.speed < 10 && v.speed > 0 && v.status === 'DELAYED' && v.matchedRoad !== 'Local road' && !v.missionBreaks?.length) {
       // Just a simple heuristic for the demo
       if (Math.sin(now / 7000 + v.id.length) > 0.995) {
         import('../store').then(({getStore}) => {
            getStore().createIncident({ type: 'CONGESTION', lat: v.lat, lon: v.lon, severity: 'MODERATE', description: `Potential incident detected via GPS anomaly on ${v.id} (${v.matchedRoad})`, provider: 'gps-anomaly', edgeId: null, closedEdge: false }).catch(()=>{});
         });
       }
    }
  });
  recalculateAll();
  const payload = { timestamp: new Date().toISOString(), vehicles: getFleetVehicles() };
  getIo()?.emit('fleet_update', payload);
  return payload;
}

export function ingestGps(id: string, lat: number, lon: number, speedKmph = 0, heading = 0) {
  init();
  let v = vehicles!.get(id);
  const g = getGraph();
  if (!v) {
    const nodeId = g.nearestNode(lat, lon);
    const node = g.nodes.get(nodeId)!;
    v = {
      id, name: 'Citizen Delivery', registration: 'N/A', lat, lon, speed: speedKmph, heading,
      status: speedKmph < 3 ? 'IDLE' : 'ON_ROUTE', eta: '--', etaMinutes: 0, deliveries: 1, completedDeliveries: 0,
      nextStop: 'Destination', routeProgressPct: 0, distanceRemainingKm: 0, lastGpsAt: new Date().toISOString(),
      locationSource: 'GPS', confidencePct: 100, matchedRoad: 'Local road', city: 'Pune', temperatureC: null,
      routeGeometry: [], mission: null, path: [{lat, lon}], segment: 0, segmentProgress: 0, targetSpeed: 0, lastTick: Date.now(), destinationIndex: 0, missionBreaks: []
    };
    vehicles!.set(id, v);
  }
  const nodeId = g.nearestNode(lat, lon);
  const node = g.nodes.get(nodeId)!;
  let bestSegment = 0, bestD = Infinity;
  v.path.forEach((p,i) => { const d = haversineKm(lat,lon,p.lat,p.lon); if (d < bestD) { bestD=d; bestSegment=i; } });
  v.segment = Math.min(bestSegment, Math.max(0,v.path.length-2));
  v.segmentProgress = 0;
  v.lat = lat; v.lon = lon;
  v.speed = Math.max(0, Math.round(speedKmph*10)/10);
  v.heading = heading;
  v.status = speedKmph < 3 ? 'IDLE' : speedKmph < 12 ? 'DELAYED' : 'ON_ROUTE';
  v.locationSource = 'GPS';
  v.confidencePct = Math.max(65, Math.round(100 - bestD*8));
  v.matchedRoad = [...g.neighbors(nodeId)][0]?.name || 'Matched road';
  v.lastGpsAt = new Date().toISOString();
  recalculateAll();
  const result = getFleetVehicle(id);
  getIo()?.emit('vehicle_location', result);
  return result;
}
