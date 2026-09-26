import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { twin } from '../twin/engine';
import { TWIN_EVENT_TYPES, specOf } from '../twin/types';
import { codeOf, roadCodeMap } from '../twin/roadCodes';
import { summarize } from '../learning/actualVsPredicted';
import { startMission } from '../services/fleetTracker';
import { getIo } from '../socket';
import { env } from '../config/env';

const algo = z.enum(['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT']);
const optSchema = z.object({ algorithm: algo.default('QPSO'), populationSize: z.number().min(4).max(200).default(30), maxIterations: z.number().min(5).max(500).default(100), seed: z.number().int().optional(), sessionId: z.string().optional(), snapRoads: z.boolean().default(true) });

const slimPlan = (p: any) => p;   // plans are already API-shaped

export const state = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  twin.ensureLoaded();
  res.json({ success: true, ...twin.snapshot(), plan: twin.currentPlan ? slimPlan(twin.currentPlan) : null, learning: summarize().status });
});

export const load = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = z.object({ customers: z.number().int().min(1).max(200).default(12), vehicles: z.number().int().min(1).max(20).default(4), seed: z.number().int().default(42), startTimeMin: z.number().min(0).max(1439).default(540) }).parse(req.body ?? {});
  try { res.json({ success: true, ...twin.load(b) }); } catch (e: any) { throw new ApiError(400, e.message, 'TWIN_LOAD_FAILED'); }
});

export const optimize = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = optSchema.parse(req.body ?? {});
  twin.ensureLoaded();
  if (b.algorithm === 'EXACT' && twin.customers().length > 9) throw new ApiError(400, 'EXACT is limited to 9 deliveries; load a smaller twin or choose another algorithm.', 'EXACT_TOO_LARGE');
  const io = getIo();
  const plan = twin.optimize({ ...b, onProgress: b.sessionId ? (iteration, total, bestFitness) => io?.to(b.sessionId!).emit('optimization_progress', { iteration, total, bestFitness }) : undefined });
  if (b.snapRoads && !env.ROUTING_OFFLINE) await twin.enrichGeometry(plan);
  if (b.sessionId) io?.to(b.sessionId).emit('optimization_complete', { id: plan.id, bestFitness: plan.fitness });
  res.json({ success: true, plan });
});

export const applyEvent = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = z.object({
    type: z.enum(TWIN_EVENT_TYPES as [string, ...string[]]), road: z.string().optional(), vehicleId: z.string().optional(), percent: z.number().positive().max(500).optional(),
    condition: z.enum(['Clear Sky', 'Light Rain', 'Heavy Rain', 'Dense Fog', 'Storm']).optional(), scope: z.enum(['ALL', 'MAJOR', 'ROAD']).optional(), note: z.string().max(200).optional(),
    reoptimize: z.boolean().default(false), algorithm: algo.default('AQPSO'),
  }).parse(req.body);
  const { reoptimize, algorithm, ...request } = b;
  let out;
  try { out = await twin.applyEvent(request as any); } catch (e: any) { throw new ApiError(400, e.message, 'EVENT_REJECTED'); }
  const re = reoptimize && twin.currentPlan ? twin.reoptimize({ algorithm, reason: out.event.description }) : null;
  res.json({ success: true, ...out, reoptimization: re, twinVersion: twin.version });
});

export const reoptimize = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = optSchema.partial({ algorithm: true }).extend({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
  try { res.json({ success: true, ...twin.reoptimize({ ...b, algorithm: b.algorithm ?? 'AQPSO' }) }); }
  catch (e: any) { throw new ApiError(409, e.message, 'REOPTIMIZE_FAILED'); }
});

export const resetEvents = asyncHandler(async (_req: AuthedRequest, res: Response) => { twin.ensureLoaded(); twin.resetEvents(); res.json({ success: true, ...twin.snapshot() }); });

export const getPlan = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = twin.getPlan(req.params.id); if (!p) throw new ApiError(404, 'Plan not found', 'NOT_FOUND'); res.json({ success: true, plan: p });
});

export const execute = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = z.object({ planId: z.string().optional(), record: z.boolean().default(true) }).parse(req.body ?? {});
  try { res.json({ success: true, ...twin.simulateExecution(b.planId, b.record), learning: summarize() }); } catch (e: any) { throw new ApiError(409, e.message, 'NO_PLAN'); }
});

/** Push the active plan to the live fleet tracker: each vehicle receives its ordered stops as a real mission. */
export const dispatch = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = twin.currentPlan; if (!plan) throw new ApiError(409, 'No active plan to dispatch.', 'NO_ACTIVE_PLAN');
  const started: string[] = []; const failed: string[] = [];
  for (const r of plan.routes) {
    const stops = [...r.stops.map((s) => { const d = twin.deliveries.find((x) => x.id === s.deliveryId)!; return { label: d.label, lat: d.lat, lon: d.lon }; })];
    const depot = twin.graph.nodes.get(twin.depotId)!; stops.push({ label: 'Depot (return)', lat: depot.lat, lon: depot.lon });
    try { (await startMission(r.vehicleId, stops)) ? started.push(r.vehicleId) : failed.push(r.vehicleId); } catch { failed.push(r.vehicleId); }
  }
  res.json({ success: true, started, failed, planId: plan.id });
});

export const roads = asyncHandler(async (req: AuthedRequest, res: Response) => {
  twin.ensureLoaded();
  const g = twin.graph; const codes = roadCodeMap(g); const q = String(req.query.q ?? '').toLowerCase();
  const use = new Map<string, number>();
  twin.currentPlan?.routes.forEach((r) => r.edgePath.forEach((e) => { const b = e.endsWith('_r') ? e.slice(0, -2) : e; use.set(b, (use.get(b) ?? 0) + 1); }));
  const list = [...codes.entries()].map(([id, code]) => { const e = g.edges.get(id)!; return { id, code, name: e.name, roadType: e.roadType, distanceKm: e.distanceKm, closed: e.closed, congestionPct: e.congestionPct, usedByPlan: use.get(id) ?? 0 }; })
    .filter((r) => (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q) && (!req.query.used || r.usedByPlan > 0) && (!req.query.city || r.id.startsWith(String(req.query.city))))
    .sort((a, b) => b.usedByPlan - a.usedByPlan || a.code.localeCompare(b.code)).slice(0, 80);
  res.json({ success: true, roads: list });
});
void codeOf; void specOf;
