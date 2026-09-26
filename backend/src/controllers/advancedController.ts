import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { twin } from '../twin/engine';
import { simulateScenario, resilience, regret, timeWindowReport, explainPlan, routeDnaOf, standardScenarios, ScenarioSpec } from '../twin/analytics';
import { EventRequest, TWIN_EVENT_TYPES } from '../twin/types';
import { recordObservation, summarize, etaCorrection, listObservations } from '../learning/actualVsPredicted';

const eventSchema = z.object({
  type: z.enum(TWIN_EVENT_TYPES as [string, ...string[]]), road: z.string().optional(), vehicleId: z.string().optional(),
  percent: z.number().positive().max(500).optional(), condition: z.enum(['Clear Sky', 'Light Rain', 'Heavy Rain', 'Dense Fog', 'Storm']).optional(),
  scope: z.enum(['ALL', 'MAJOR', 'ROAD']).optional(), note: z.string().max(200).optional(),
});
const simOpts = z.object({ planId: z.string().optional(), algorithm: z.enum(['QPSO', 'AQPSO', 'PSO', 'GA', 'SA']).optional(), populationSize: z.number().min(4).max(100).optional(), maxIterations: z.number().min(5).max(300).optional(), seed: z.number().int().optional() });
const specSchema = z.object({ name: z.string().min(1).max(60), requests: z.array(eventSchema).max(6) });

function needPlan() {
  twin.ensureLoaded();
  if (!twin.currentPlan) throw new ApiError(409, 'No active plan. Run an optimization on the digital twin first (POST /api/twin/optimize).', 'NO_ACTIVE_PLAN');
}

export const scenarioPreview = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = simOpts.extend({ name: z.string().optional(), requests: z.array(eventSchema).min(1).max(6) }).parse(req.body);
  const out = simulateScenario(twin, { name: body.name ?? 'CUSTOM', requests: body.requests as EventRequest[] }, body);
  const { reoptimizedPlan, ...rest } = out;
  res.json({ success: true, ...rest, reoptimizedPlanId: null, reoptimizedRoutes: reoptimizedPlan.routes.map((r) => ({ vehicleId: r.vehicleId, stops: r.stops.map((s) => s.deliveryId), distanceKm: r.distanceKm, totalTimeMin: r.totalTimeMin, geometry: r.geometry })) });
});

export const resilienceAnalysis = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = simOpts.extend({ scenarios: z.array(specSchema).min(1).max(10).optional() }).parse(req.body ?? {});
  res.json({ success: true, planId: body.planId ?? twin.currentPlanId, ...resilience(twin, { ...body, scenarios: body.scenarios as ScenarioSpec[] | undefined }) });
});

export const regretAnalysis = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = simOpts.extend({ scenarios: z.array(specSchema).min(1).max(10).optional() }).parse(req.body ?? {});
  res.json({ success: true, ...regret(twin, { ...body, scenarios: body.scenarios as ScenarioSpec[] | undefined }) });
});

export const counterfactualAnalysis = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = simOpts.extend({ requests: z.array(eventSchema).min(1).max(6) }).parse(req.body);
  const out = simulateScenario(twin, { name: 'COUNTERFACTUAL', requests: body.requests as EventRequest[] }, body);
  res.json({
    success: true, label: 'SIMULATED', description: out.description, withoutReoptimization: out.withoutReoptimization, withReoptimization: out.withReoptimization,
    ...out.counterfactual, reassigned: out.diff.reassigned, affectedVehicles: out.affectedVehicles, affectedDeliveries: out.affectedDeliveries, method: out.method,
    note: 'Both sides are simulated on a clone of the live twin under the same event(s); this is not a claim of measured field performance.',
  });
});

export const timeWindow = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = z.object({ planId: z.string().optional() }).parse(req.body ?? {});
  const plan = body.planId ? twin.getPlan(body.planId) : twin.currentPlan;
  if (!plan) throw new ApiError(404, 'Plan not found', 'NOT_FOUND');
  res.json({ success: true, ...timeWindowReport(plan) });
});

export const dna = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = z.object({ planId: z.string().optional(), withAnalysis: z.boolean().default(false) }).parse(req.body ?? {});
  const plan = body.planId ? twin.getPlan(body.planId) : twin.currentPlan;
  if (!plan) throw new ApiError(404, 'Plan not found', 'NOT_FOUND');
  let extra: { resilience?: number; regretMin?: number } | undefined;
  if (body.withAnalysis) { const r = resilience(twin, { planId: plan.id }); const g = regret(twin, { planId: plan.id }); extra = { resilience: r.score, regretMin: g.maxRegretMin }; }
  res.json({ success: true, routeDna: routeDnaOf(plan, extra) });
});

export const explanation = asyncHandler(async (req: AuthedRequest, res: Response) => {
  needPlan();
  const body = z.object({ planId: z.string().optional() }).parse(req.body ?? {});
  const plan = body.planId ? twin.getPlan(body.planId) : twin.currentPlan;
  if (!plan) throw new ApiError(404, 'Plan not found', 'NOT_FOUND');
  res.json({ success: true, ...explainPlan(plan) });
});

export const actualVsPredicted = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = z.object({
    predictedEtaMinutes: z.number().nonnegative(), actualEtaMinutes: z.number().nonnegative(),
    predictedDistanceKm: z.number().nonnegative().optional(), actualDistanceKm: z.number().nonnegative().optional(),
    predictedTraffic: z.number().min(0).max(1).optional(), observedTraffic: z.number().min(0).max(1).optional(),
    vehicleId: z.string().optional(), deliveryId: z.string().optional(), planId: z.string().optional(), road: z.string().optional(), weather: z.string().optional(),
    source: z.enum(['MEASURED', 'SIMULATED_EXECUTION']).default('MEASURED'),
  }).parse(req.body);
  const obs = recordObservation({
    source: body.source, planId: body.planId, vehicleId: body.vehicleId, deliveryId: body.deliveryId, road: body.road, hourOfDay: new Date().getHours(), weather: body.weather ?? 'Clear Sky',
    predictedEtaMin: body.predictedEtaMinutes, actualEtaMin: body.actualEtaMinutes, predictedDistanceKm: body.predictedDistanceKm, actualDistanceKm: body.actualDistanceKm,
    predictedTraffic: body.predictedTraffic, observedTraffic: body.observedTraffic,
  });
  res.json({
    success: true, label: body.source, recorded: obs,
    errors: { etaMinutes: Number((obs.actualEtaMin - obs.predictedEtaMin).toFixed(3)), distanceKm: obs.actualDistanceKm !== undefined && obs.predictedDistanceKm !== undefined ? Number((obs.actualDistanceKm - obs.predictedDistanceKm).toFixed(3)) : null, trafficPctPoints: obs.observedTraffic !== undefined && obs.predictedTraffic !== undefined ? Number(((obs.observedTraffic - obs.predictedTraffic) * 100).toFixed(3)) : null },
    summary: summarize(),
  });
});

export const learningSummary = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ success: true, summary: summarize(), correction: etaCorrection(), recent: listObservations(25) });
});

export const scenarioCatalog = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ success: true, scenarios: standardScenarios(), eventTypes: TWIN_EVENT_TYPES });
});
