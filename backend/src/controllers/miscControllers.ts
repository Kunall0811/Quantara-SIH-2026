import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { getNetworkTrafficSummary, getTrafficAt, getIncidents } from '../services/trafficManager';
import { triggerScenario, ScenarioType, resolveIncident } from '../services/simulationService';
import { getWeather } from '../providers/freeProviders';
import { geocodeAddress } from '../services/routingManager';
import { nominatimReverseGeocode } from '../providers/freeProviders';
import { getGraph, setEdgeTraffic, closeEdge, triggerSimulation, currentWeather } from '../services/graphService';
import { INDIA_CITIES } from '../data/indiaGraph';
import { getStore } from '../store';
import { getIo } from '../socket';

// --- Traffic ---
export const trafficStatus = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const summary = await getNetworkTrafficSummary();
  res.json({ success: true, ...summary });
});

export const trafficFlow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string) || 18.5204;
  const lon = parseFloat(req.query.lon as string) || 73.8567;
  const flow = await getTrafficAt(lat, lon);
  res.json({ success: true, ...flow });
});

export const trafficIncidents = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  
  let south, west, north, east;
  if (!isNaN(lat) && !isNaN(lon)) {
    south = lat - 0.2;
    north = lat + 0.2;
    west = lon - 0.2;
    east = lon + 0.2;
  } else {
    south = parseFloat(req.query.south as string) || 18.4;
    west = parseFloat(req.query.west as string) || 73.7;
    north = parseFloat(req.query.north as string) || 18.7;
    east = parseFloat(req.query.east as string) || 74.0;
  }

  const bbox = { south, west, north, east };
  const result = await getIncidents(bbox);
  res.json({ success: true, ...result });
});

const manualIncidentSchema = z.object({
  type: z.enum(['ACCIDENT','ROAD_CLOSURE','HAZARD','FLOOD','HEAVY_RAIN','CONGESTION']).default('ACCIDENT'),
  lat: z.number().min(6).max(37), lon: z.number().min(68).max(97),
  severity: z.enum(['LOW','MODERATE','HIGH','SEVERE']).default('HIGH'),
  description: z.string().min(3).max(300).default('Admin reported incident'),
});
export const createManualIncident = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = manualIncidentSchema.parse(req.body);
  const g = getGraph();
  const nodeId = g.nearestNode(body.lat, body.lon);
  const nearest = g.neighbors(nodeId).filter(e => !e.id.endsWith('_r')).sort((a,b) => {
    const av = g.nodes.get(a.v)!; const bv = g.nodes.get(b.v)!;
    const da = Math.hypot(av.lat-body.lat, av.lon-body.lon); const db = Math.hypot(bv.lat-body.lat, bv.lon-body.lon);
    return da-db;
  })[0];
  let closedEdge = false;
  if (nearest) {
    if (body.type === 'ROAD_CLOSURE') { closeEdge(nearest.id); closedEdge = true; }
    else if (body.type === 'ACCIDENT' || body.type === 'HAZARD' || body.type === 'FLOOD' || body.type === 'CONGESTION') setEdgeTraffic(nearest.id, body.severity === 'SEVERE' ? 'SEVERE' : body.severity === 'HIGH' ? 'HIGH' : body.severity === 'MODERATE' ? 'MODERATE' : 'LOW', body.severity === 'SEVERE' ? .95 : body.severity === 'HIGH' ? .8 : body.severity === 'MODERATE' ? .55 : .2);
  }
  const incident = await getStore().createIncident({ ...body, provider: 'admin-console', edgeId: nearest?.id ?? null, closedEdge });
  getIo()?.emit('incident_update', { type: 'CREATED', incident });
  res.json({ success: true, incident, affectedRoad: nearest?.name || null });
});

const simulateSchema = z.object({ scenarioType: z.enum(['ACCIDENT', 'ROAD_CLOSURE', 'RUSH_HOUR', 'HEAVY_RAIN', 'RANDOM_CONGESTION']), edgeId: z.string().optional(), cityKey: z.string().optional() });

export const trafficSimulate = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { scenarioType, edgeId, cityKey } = simulateSchema.parse(req.body);
  const result = await triggerScenario(scenarioType as ScenarioType, edgeId, cityKey);
  res.json({ success: true, scenarioType, result });
});

export const resolveIncidentHandler = asyncHandler(async (req: AuthedRequest, res: Response) => {
  await resolveIncident(req.params.id);
  getIo()?.emit('incident_update', { type: 'RESOLVED', id: req.params.id });
  res.json({ success: true });
});

// --- Weather ---
const weatherSimulationSchema = z.object({ condition: z.enum(['Clear Sky', 'Heavy Rain', 'Dense Fog', 'Storm']) });

export const simulateWeather = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { condition } = weatherSimulationSchema.parse(req.body);
  triggerSimulation(condition);
  getIo()?.emit('weather_update', { condition, weather: currentWeather });
  res.json({ success: true, condition, weather: currentWeather });
});

export const weather = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string) || 18.5204;
  const lon = parseFloat(req.query.lon as string) || 73.8567;
  const data = await getWeather(lat, lon);
  // Merge live simulated weather onto real weather context
  const merged = { ...data, current: {
    temperature: data.temperature,
    windSpeed: data.windSpeed,
    weatherCode: data.weatherCode,
    rain: currentWeather.rainMmPerH > 0 ? 1 : 0,
    condition: currentWeather.condition,
  } };
  res.json({ success: true, ...merged });
});

// --- Maps ---
export const geocode = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const address = req.query.address as string;
  if (!address) throw new ApiError(400, 'address query param required', 'INVALID_REQUEST');
  const result = await geocodeAddress(address);
  res.json(result);
});

export const reverseGeocode = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (isNaN(lat) || isNaN(lon)) throw new ApiError(400, 'lat and lon query params required', 'INVALID_REQUEST');
  const result = await nominatimReverseGeocode(lat, lon);
  res.json(result || { success: false, message: 'Could not reverse-geocode.' });
});

export const search = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const q = ((req.query.q as string) || '').toLowerCase();
  const graph = getGraph();
  const matches: { id: string; name: string; lat: number; lon: number }[] = [];
  for (const [id, n] of graph.nodes) {
    if (n.name?.toLowerCase().includes(q)) matches.push({ id, name: n.name!, lat: n.lat, lon: n.lon });
    if (matches.length >= 10) break;
  }
  res.json({ success: true, results: matches, cities: INDIA_CITIES.map((c) => ({ key: c.key, name: c.name, lat: c.lat, lon: c.lon })) });
});

export const mapRoute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.json({ success: true, message: 'Use POST /api/routes/calculate.' });
});

// --- Notifications ---
export const listNotifications = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const notifications = await store.listNotifications(req.user?.sub || null);
  res.json({ success: true, notifications });
});

export const markNotificationRead = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const { id } = req.params;
  await store.markNotificationRead(id);
  res.json({ success: true });
});

export const dismissAllNotifications = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  await store.dismissAllNotifications(req.user?.sub || null);
  res.json({ success: true });
});
