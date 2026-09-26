import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { getFleetVehicle, getFleetVehicles, ingestGps, startMission, cancelMission } from '../services/fleetTracker';

export const list = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const vehicles = getFleetVehicles();
  res.json({ success: true, timestamp: new Date().toISOString(), source: 'LIVE_TRACKER', algorithm: 'nearest-road map matching + speed smoothing + route-progress ETA', vehicles });
});

export const getOne = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const vehicle = getFleetVehicle(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found', 'NOT_FOUND');
  res.json({ success: true, vehicle });
});

const gpsSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), speedKmph: z.number().min(0).max(250).default(0), heading: z.number().min(0).max(360).default(0) });
export const gps = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = gpsSchema.parse(req.body);
  const vehicle = ingestGps(req.params.id, body.lat, body.lon, body.speedKmph, body.heading);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found', 'NOT_FOUND');
  res.json({ success: true, vehicle });
});

export const citizenGps = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = gpsSchema.parse(req.body);
  // Using a mock citizen vehicle ID for demo purposes
  const vehicle = ingestGps('Q-CITIZEN', body.lat, body.lon, body.speedKmph, body.heading);
  res.json({ success: true, vehicle });
});

export const citizenStatus = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { status } = z.object({ status: z.enum(['ACCEPTED', 'ON_ROUTE', 'DELIVERED']) }).parse(req.body);
  const v = getFleetVehicle('Q-CITIZEN');
  if (v) {
     import('../socket').then(({getIo}) => getIo()?.emit('citizen_task_update', { status, timestamp: new Date().toISOString() }));
  }
  res.json({ success: true, status });
});

const missionSchema = z.object({
  stops: z.array(z.object({ label: z.string().min(1).max(80), lat: z.number().min(6).max(37), lon: z.number().min(68).max(97) })).min(1).max(30),
});
/** Start a real multi-stop mission: vehicle automatically progresses stop to
 *  stop along actual roads, no manual map interaction required (section 4). */
export const startVehicleMission = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = missionSchema.parse(req.body);
  const isCitizenOrAll = req.params.id === 'Q-CITIZEN' || req.params.id === 'ALL';
  const vehicle = await startMission(req.params.id, body.stops);
  if (!vehicle && !isCitizenOrAll) throw new ApiError(404, 'Vehicle not found or mission could not be planned', 'NOT_FOUND');
  
  if (isCitizenOrAll) {
     const origin = body.stops[0];
     const destination = body.stops[body.stops.length - 1];
     const payload = {
       taskId: req.body.taskId || `TASK-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
       assignedUser: req.body.assignedUser || "Citizen-01",
       title: req.body.title || "Emergency Route Clearance / Delivery",
       source: { name: origin.label || "Pickup", lat: origin.lat, lng: origin.lon },
       destination: { name: destination.label || "Dropoff", lat: destination.lat, lng: destination.lon },
       priority: req.body.priority || "HIGH",
       status: "PENDING",
       timestamp: new Date().toISOString(),
       stops: body.stops // For backwards compatibility
     };
     import('../store').then(({getStore}) => {
       getStore().createNotification({
         userId: null,
         title: `Mission Assigned: ${payload.title}`,
         message: `Task ID: ${payload.taskId}. Route: ${payload.source.name} to ${payload.destination.name}`,
         payload, // Store full rich payload with lat/lon for frontend
       }).catch(console.error);
     });
     import('../socket').then(({getIo}) => getIo()?.emit('citizen_mission_dispatched', payload));
  }
  
  res.json({ success: true, vehicle });
});

export const cancelVehicleMission = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const vehicle = cancelMission(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found or has no active mission', 'NOT_FOUND');
  res.json({ success: true, vehicle });
});
