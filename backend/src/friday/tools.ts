import { getStore } from '../store';
import { getNetworkTrafficSummary, getIncidents } from '../services/trafficManager';
import { getWeather } from '../providers/freeProviders';
import { getGraph, setEdgeTraffic, closeEdge } from '../services/graphService';
import { triggerScenario, ScenarioType } from '../services/simulationService';
import { calculateRoute, geocodeAddress } from '../services/routingManager';
import { getFleetVehicle, getFleetVehicles } from '../services/fleetTracker';

import { TWIN_TOOLS, TWIN_WRITE_TOOLS } from './twinTools';

export const WRITE_TOOLS = new Set(['incidents.create_incident', 'incidents.resolve_incident', 'incidents.create_at_address', ...TWIN_WRITE_TOOLS]);
export function isWriteTool(tool: string) { return WRITE_TOOLS.has(tool); }

export const TOOLS: Record<string, (params: any) => Promise<any>> = {
  'system.get_health': async () => {
    const store = getStore(); const incidents = await store.listActiveIncidents(); const results = await store.listOptimizationResults(50);
    return { activeIncidents: incidents.length, optimizationRuns: results.length, dbBackend: store.backend, serverTime: new Date().toISOString() };
  },
  'traffic.get_current_status': async () => getNetworkTrafficSummary(),
  'traffic.get_incidents': async () => getIncidents({ south: 18.4, west: 73.7, north: 18.7, east: 74.0 }),
  'weather.get_current': async (p) => getWeather(p.lat ?? 18.5204, p.lon ?? 73.8567),
  'citizen.delivery_status': async () => ({ success: true }),
  'fleet.list': async () => ({ timestamp: new Date().toISOString(), vehicles: getFleetVehicles() }),
  'fleet.get_vehicle': async (p) => {
    const vehicle = getFleetVehicle(p.vehicleId);
    return vehicle ? { vehicle, live: true, algorithm: 'route-progress + nearest-road matching + speed smoothing', action: { type: 'FOCUS_VEHICLE', vehicleId: vehicle.id, lat: vehicle.lat, lon: vehicle.lon } } : { error: `Vehicle ${p.vehicleId} not found` };
  },
  'fleet.reroute_vehicle': async (p) => {
    const vehicle = getFleetVehicle(p.vehicleId);
    if (!vehicle) return { error: `Vehicle ${p.vehicleId} not found` };
    const destination = { lat: 18.5010, lon: 73.8580, label: vehicle.nextStop };
    const route = await calculateRoute({ lat: vehicle.lat, lon: vehicle.lon }, destination);
    return { vehicleId: vehicle.id, route, action: { type: 'SHOW_REROUTE', vehicleId: vehicle.id, geometry: route.geometry } };
  },
  'fleet.reroute_all_delayed': async () => {
    const delayed = getFleetVehicles().filter(v => v.status === 'DELAYED');
    const results = await Promise.all(delayed.map(async v => {
      const route = await calculateRoute({lat:v.lat,lon:v.lon},{lat:18.5010,lon:73.8580});
      return {vehicleId:v.id,distanceKm:route.distanceKm,durationMinutes:route.durationMinutes,provider:route.provider};
    }));
    return {count:results.length,results,action:{type:'REFRESH_FLEET'}};
  },
  'weather.simulate_weather': async (p) => {
    triggerScenario(p.condition === 'HEAVY_RAIN' ? 'HEAVY_RAIN' : 'RANDOM_CONGESTION');
    return { success: true, condition: p.condition, action: { type: 'REFRESH_WEATHER' } };
  },
  'fleet.assign_task': async (p) => {
    const { startMission } = require('../services/fleetTracker');
    const result = await startMission(p.vehicleId, p.stops || [{ label: p.destination, lat: p.lat, lon: p.lon }]);
    return result ? { success: true, vehicleId: p.vehicleId, action: { type: 'REFRESH_FLEET' } } : { error: 'Failed to assign task' };
  },
  'optimization.optimize_routes': async (p) => {
    // A placeholder tool that resolves back to frontend instruction since the frontend has the state
    return { success: true, action: { type: 'TRIGGER_OPTIMIZATION' } };
  },
  'optimization.run': async () => ({ success: true, action: { type: 'NAVIGATE', page: 'plan', command: 'RUN_OPTIMIZATION' } }),
  'optimization.benchmark': async () => ({ success: true, action: { type: 'NAVIGATE', page: 'plan' } }),
  'optimization.convergence': async () => ({ success: true, action: { type: 'NAVIGATE', page: 'plan' } }),
  'map.set_mode': async (p) => ({ action: { type: 'SET_MAP_MODE', mode: p.mode } }),
  'navigation.open': async (p) => ({ action: { type: 'NAVIGATE', page: p.page, command: p.action || null } }),
  'routes.calculate': async (p) => !p.origin || !p.destination ? { error: 'origin and destination required' } : calculateRoute(p.origin, p.destination),
  'incidents.create_incident': async (p) => triggerScenario((p.incidentType || 'ACCIDENT') as ScenarioType, p.edgeId),
  'incidents.create_at_address': async (p) => {
    const geo = await geocodeAddress(p.address || 'Pune');
    if (!geo.success) return geo;
    const g = getGraph(); const nodeId = g.nearestNode(geo.lat, geo.lon); const edge = g.neighbors(nodeId).find(e => !e.id.endsWith('_r'));
    if (edge) { if ((p.type||'ACCIDENT') === 'ROAD_CLOSURE') closeEdge(edge.id); else setEdgeTraffic(edge.id, p.severity==='SEVERE'?'SEVERE':p.severity==='HIGH'?'HIGH':'MODERATE', p.severity==='SEVERE'?.95:p.severity==='HIGH'?.8:.55); }
    const store = getStore();
    const incident = await store.createIncident({type:p.type||'ACCIDENT',lat:geo.lat,lon:geo.lon,severity:p.severity||'HIGH',description:p.description||`Admin reported incident at ${geo.displayName}`,provider:'friday-admin'});
    return {incident,affectedRoad:edge?.name||null,action:{type:'REFRESH_INCIDENTS',lat:geo.lat,lon:geo.lon}};
  },
  'incidents.resolve_incident': async (p) => { const store = getStore(); await store.resolveIncident(p.incidentId); return { resolved: true, action:{type:'REFRESH_INCIDENTS'} }; },
  'analytics.get_statistics': async () => {
    const store = getStore(); const results = await store.listOptimizationResults(20);
    return { totalRuns: results.length, lastRun: results[0] ? { algorithm: results[0].algorithm, distanceKm: results[0].distanceKm, durationMinutes: results[0].durationMinutes } : null };
  },
  ...TWIN_TOOLS,
};
