import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { getGraph } from '../services/graphService';
import { getWeather } from '../providers/freeProviders';
import { getStore } from '../store';
import { DEFAULT_WEIGHTS, FitnessWeights, VehicleProfileLite, Customer, RouteEvaluation, VrpEvaluation } from '../optimization/fitness';
import { runAlgorithm, ALL_ALGORITHM_IDS, ALGORITHM_LABELS, RunParams, AlgorithmId, OptimizerResult } from '../optimization';
import { QPSO_DEFAULTS } from '../optimization/qpso/QPSO';
import { ADAPTIVE_DEFAULTS } from '../optimization/qpso/AdaptiveQPSO';
import { PSO_DEFAULTS } from '../optimization/pso';
import { GA_DEFAULTS } from '../optimization/geneticAlgorithm';
import { runBenchmark, DEFAULT_SEEDS } from '../optimization/benchmarkEngine';
import { setLastBenchmark, getLastBenchmark } from '../optimization/benchmarkStore';
import { EXACT_MAX_CUSTOMERS } from '../optimization/exactSolver';
import { generateDataset } from '../optimization/datasetGenerator';
import { validateProblemInstance } from '../optimization/constraints';
import { buildSteps, graphGeometry } from '../twin/directions';
import { env } from '../config/env';
import { getIo } from '../socket';
import { calculateRouteThrough } from '../services/routingManager';

const ALGO_ENUM = z.enum(['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT']);
const pointSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const vehicleSchema = z.object({
  fuelEfficiencyKmPerL: z.number().positive().default(15),
  fuelType: z.enum(['petrol', 'diesel', 'electric', 'cng']).default('petrol'),
  priority: z.enum(['normal', 'high', 'emergency']).default('normal'),
});
const weightsSchema = z.object({
  distance: z.number().min(0).default(DEFAULT_WEIGHTS.distance), travelTime: z.number().min(0).default(DEFAULT_WEIGHTS.travelTime),
  traffic: z.number().min(0).default(DEFAULT_WEIGHTS.traffic), fuelCost: z.number().min(0).default(DEFAULT_WEIGHTS.fuelCost),
  risk: z.number().min(0).default(DEFAULT_WEIGHTS.risk), weather: z.number().min(0).default(DEFAULT_WEIGHTS.weather), turns: z.number().min(0).default(DEFAULT_WEIGHTS.turns),
});

const optimizeSchema = z.object({
  origin: pointSchema, destination: pointSchema,
  waypoints: z.array(pointSchema).max(60).default([]),
  vehicle: vehicleSchema.default({ fuelEfficiencyKmPerL: 15, fuelType: 'petrol', priority: 'normal' }),
  weights: weightsSchema.default({ ...DEFAULT_WEIGHTS }),
  algorithm: ALGO_ENUM.default('QPSO'),
  populationSize: z.number().min(4).max(200).default(30),
  maxIterations: z.number().min(5).max(1000).default(100),
  seed: z.number().optional(),
  useWeather: z.boolean().default(true),
});

async function weatherFor(use: boolean, lat: number, lon: number) {
  if (!use || env.ROUTING_OFFLINE) return { rainMm: 0, weatherSeverity: 0 };
  const w = await getWeather(lat, lon);
  return { rainMm: w.rainMm ?? 0, weatherSeverity: w.weatherSeverity ?? 0 };
}

const ll = (graph: ReturnType<typeof getGraph>, id: string) => { const n = graph.nodes.get(id)!; return { lat: n.lat, lon: n.lon }; };
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Snap geometry to real roads through the optimizer's waypoints when routing is online; otherwise internal-graph geometry (FALLBACK). */
async function geometryFor(graph: ReturnType<typeof getGraph>, nodePath: string[], order: string[]) {
  const fallback = graphGeometry(graph, nodePath);
  if (env.ROUTING_OFFLINE || order.length < 2) return { geometry: fallback, geometrySource: 'FALLBACK' as const };
  try {
    const route = await calculateRouteThrough(order.map((n) => ll(graph, n)));
    if (route?.geometry?.length > 1) return { geometry: route.geometry, geometrySource: route.provider === 'tomtom' ? ('LIVE' as const) : ('FALLBACK' as const), provider: route.provider };
  } catch (e) { console.error('geometry lookup failed', e); }
  return { geometry: fallback, geometrySource: 'FALLBACK' as const };
}

const runMeta = (res: OptimizerResult) => ({
  seed: res.seed, parameters: res.parameters, evaluations: res.evaluations,
  stoppedBy: res.stoppedBy, feasible: res.feasible, constraintViolations: res.constraintViolations, adaptive: res.adaptive,
  iterationHistory: res.iterationHistory, evaluationsHistory: res.evaluationsHistory,
});

function progressCb(room?: string): RunParams['onProgress'] {
  if (!room) return undefined;
  const io = getIo();
  return (iteration, total, bestFitness) => { io?.to(room).emit('optimization_progress', { iteration, total, bestFitness }); };
}

async function performOptimization(req: AuthedRequest, res: Response) {
  const body = optimizeSchema.parse(req.body);
  const socketRoom = (req.body.sessionId as string) || undefined;
  const graph = getGraph();
  const originId = graph.nearestNode(body.origin.lat, body.origin.lon);
  const destinationId = graph.nearestNode(body.destination.lat, body.destination.lon);
  const waypointIds = body.waypoints.map((w) => graph.nearestNode(w.lat, w.lon));
  if (body.algorithm === 'EXACT' && waypointIds.length > EXACT_MAX_CUSTOMERS) throw new ApiError(400, `EXACT is limited to ${EXACT_MAX_CUSTOMERS} waypoints; got ${waypointIds.length}.`, 'EXACT_TOO_LARGE');
  const params: RunParams = {
    graph, originId, destinationId, waypointIds, weights: body.weights as FitnessWeights, vehicle: body.vehicle as VehicleProfileLite,
    weather: await weatherFor(body.useWeather, body.origin.lat, body.origin.lon),
    populationSize: body.populationSize, maxIterations: body.maxIterations, seed: body.seed, onProgress: progressCb(socketRoom),
  };
  const result = runAlgorithm(body.algorithm, params);
  const ev = result.bestEval as RouteEvaluation;
  const order = result.bestOrder;
  const { geometry, geometrySource } = await geometryFor(graph, ev.nodePath, order);
  const steps = buildSteps(graph, ev.nodePath, ev.edgePath, order.slice(1, -1), order.slice(1, -1).map((n, i) => graph.nodes.get(n)?.name ?? `Stop ${i + 1}`));

  const explanation = [
    `${ALGORITHM_LABELS[body.algorithm as AlgorithmId]} minimised the weighted objective (distance, time, traffic, fuel, risk, weather, turns) over ${result.evaluations} evaluations.`,
    ev.avgCongestion < 0.3 ? 'Low-congestion road segments were preferred where an alternative existed.' : 'Some congestion was unavoidable given current traffic conditions.',
    ev.unreachableSegments > 0 ? `${ev.unreachableSegments} segment(s) could not be routed and were penalised.` : 'All segments were successfully routed.',
    `Objective terms — distance ${ev.terms.distance.toFixed(1)}, time ${ev.terms.travelTime.toFixed(1)}, traffic ${ev.terms.traffic.toFixed(1)}, fuel ${ev.terms.fuelCost.toFixed(1)}, risk ${ev.terms.risk.toFixed(1)}, weather ${ev.terms.weather.toFixed(1)}, turns ${ev.terms.turns.toFixed(1)}, penalty ${ev.terms.penalty.toFixed(1)}.`,
  ];
  const saved = await getStore().saveOptimizationResult({
    userId: req.user?.sub || null, algorithm: body.algorithm, origin: body.origin, destination: body.destination,
    waypointOrder: order.slice(1, -1).map((_, i) => i), bestFitness: result.bestFitness,
    distanceKm: r1(ev.distanceKm), durationMinutes: r1(ev.durationMin), fuelCostInr: Math.round(ev.fuelCostInr), co2Kg: Math.round(ev.co2Kg * 100) / 100,
    convergence: result.convergence, runtimeSeconds: result.runtimeSeconds, iterations: result.iterations, geometry, explanation,
  });
  if (socketRoom) getIo()?.to(socketRoom).emit('optimization_complete', { id: saved.id, bestFitness: saved.bestFitness });
  res.json({
    success: true, id: saved.id, algorithm: body.algorithm, bestFitness: saved.bestFitness,
    distanceKm: saved.distanceKm, durationMinutes: saved.durationMinutes, fuelCostInr: saved.fuelCostInr, co2Kg: saved.co2Kg,
    runtimeSeconds: saved.runtimeSeconds, iterations: saved.iterations, convergence: saved.convergence, geometry: saved.geometry, geometrySource,
    explanation: saved.explanation, steps, terms: ev.terms, turns: ev.turns,
    trafficDelayMinutes: r1(ev.trafficDelayMin), avgCongestionPct: Math.round(ev.avgCongestion * 1000) / 10, riskScore: ev.riskScore,
    ...runMeta(result),
  });
}
export const runOptimization = asyncHandler(performOptimization);

const vrpSchema = z.object({
  depot: pointSchema,
  customers: z.array(z.object({
    lat: z.number(), lon: z.number(), demand: z.number().default(1), label: z.string().optional(),
    readyTime: z.number().optional(), dueTime: z.number().optional(), serviceTime: z.number().optional(), priority: z.enum(['normal', 'high', 'emergency']).optional(),
  })).min(1).max(200),
  fleet: z.array(vehicleSchema.extend({ id: z.string().optional(), capacity: z.number().positive().optional(), available: z.boolean().optional() })).min(1).max(30),
  weights: weightsSchema.default({ ...DEFAULT_WEIGHTS }),
  algorithm: ALGO_ENUM.default('QPSO'),
  populationSize: z.number().min(4).max(200).default(30),
  maxIterations: z.number().min(5).max(1000).default(100),
  seed: z.number().optional(),
  startTimeMin: z.number().min(0).max(1440).default(0),
  useWeather: z.boolean().default(true),
});

async function performVrpOptimization(req: AuthedRequest, res: Response) {
  const body = vrpSchema.parse(req.body);
  const socketRoom = (req.body.sessionId as string) || undefined;
  const graph = getGraph();
  const depotId = graph.nearestNode(body.depot.lat, body.depot.lon);
  const customers: Customer[] = body.customers.map((c, i) => ({
    id: `C${i + 1}`, nodeId: graph.nearestNode(c.lat, c.lon), demand: c.demand,
    readyTime: c.readyTime ?? body.startTimeMin, dueTime: c.dueTime ?? 1440, serviceTime: c.serviceTime ?? 10, priority: c.priority,
  }));
  const fleet: VehicleProfileLite[] = body.fleet.map((v, i) => ({
    id: v.id ?? `V-${String(i + 1).padStart(2, '0')}`, fuelEfficiencyKmPerL: v.fuelEfficiencyKmPerL, fuelType: v.fuelType, priority: v.priority,
    capacity: v.capacity ?? Math.max(20, Math.ceil(body.customers.reduce((s, c) => s + c.demand, 0) / body.fleet.length) * 2), available: v.available,
  }));
  const problems = validateProblemInstance(customers, fleet, graph, depotId);
  if (problems.length) throw new ApiError(400, `Invalid VRP instance: ${problems.join(' ')}`, 'INVALID_INSTANCE');
  if (body.algorithm === 'EXACT' && customers.length > EXACT_MAX_CUSTOMERS) throw new ApiError(400, `EXACT is limited to ${EXACT_MAX_CUSTOMERS} customers; got ${customers.length}.`, 'EXACT_TOO_LARGE');

  const params: RunParams = {
    graph, depotId, customers, fleet, weights: body.weights as FitnessWeights,
    weather: await weatherFor(body.useWeather, body.depot.lat, body.depot.lon),
    populationSize: body.populationSize, maxIterations: body.maxIterations, seed: body.seed, startTimeMin: body.startTimeMin, onProgress: progressCb(socketRoom),
  };
  const result = runAlgorithm(body.algorithm, params);
  const ev = result.bestEval as VrpEvaluation;
  const labelOf = (id: string) => body.customers[Number(id.slice(1)) - 1]?.label ?? graph.nodes.get(customers.find((c) => c.id === id)?.nodeId ?? '')?.name ?? id;

  const routesData = await Promise.all(ev.routes.map(async (r) => {
    const { geometry, geometrySource } = await geometryFor(graph, r.nodePath, r.order);
    const stopNodes = r.customerIds.map((id) => customers.find((c) => c.id === id)!.nodeId!);
    return {
      vehicleId: r.vehicleId, distanceKm: r1(r.distanceKm), durationMinutes: r1(r.durationMin), totalTimeMinutes: r1(r.totalTimeMin), load: r.load,
      capacity: fleet.find((f) => f.id === r.vehicleId)?.capacity, fuelCostInr: Math.round(r.fuelCostInr), co2Kg: Math.round(r.co2Kg * 100) / 100,
      arrivalTimes: r.arrivalTimes, stops: r.stopDetails.map((s) => ({ ...s, label: labelOf(s.customerId!) })), latenessMin: r.latenessMin, lateStops: r.lateStops,
      geometry, geometrySource, waypoints: r.order.map((n) => ll(graph, n)),
      steps: buildSteps(graph, r.nodePath, r.edgePath, stopNodes, r.customerIds.map(labelOf)), terms: r.terms,
    };
  }));
  const explanation = [
    `${ALGORITHM_LABELS[body.algorithm as AlgorithmId]} assigned ${customers.length - ev.unassigned.length} of ${customers.length} deliveries to ${ev.routes.length} of ${fleet.length} vehicles (${result.evaluations} evaluations).`,
    ev.avgCongestion < 0.3 ? 'Low-congestion road segments were prioritised.' : 'Some congestion was unavoidable.',
    ev.feasible ? 'All demands were met inside capacity and time windows.' : `Constraints violated: ${result.constraintViolations.map((v) => v.code).join(', ') || 'time windows'}; penalties applied.`,
  ];
  const saved = await getStore().saveOptimizationResult({
    userId: req.user?.sub || null, algorithm: `VRP-${body.algorithm}`, origin: body.depot, destination: body.depot, waypointOrder: [],
    bestFitness: result.bestFitness, distanceKm: r1(ev.distanceKm), durationMinutes: r1(ev.durationMin), fuelCostInr: Math.round(ev.fuelCostInr),
    co2Kg: Math.round(ev.co2Kg * 100) / 100, convergence: result.convergence, runtimeSeconds: result.runtimeSeconds, iterations: result.iterations,
    geometry: [], routes: routesData.map((r) => ({ vehicleId: r.vehicleId, geometry: r.geometry, distanceKm: r.distanceKm, durationMinutes: r.durationMinutes, load: r.load, arrivalTimes: r.arrivalTimes })), explanation,
  });
  if (socketRoom) getIo()?.to(socketRoom).emit('optimization_complete', { id: saved.id, bestFitness: saved.bestFitness });
  res.json({
    success: true, id: saved.id, bestFitness: saved.bestFitness, routes: routesData, unassigned: ev.unassigned,
    distanceKm: saved.distanceKm, durationMinutes: saved.durationMinutes, fuelCostInr: saved.fuelCostInr, co2Kg: saved.co2Kg,
    runtimeSeconds: saved.runtimeSeconds, iterations: saved.iterations, convergence: saved.convergence, explanation: saved.explanation, terms: ev.terms,
    latenessMin: ev.latenessMin, trafficDelayMinutes: r1(ev.trafficDelayMin), avgCongestionPct: Math.round(ev.avgCongestion * 1000) / 10,
    ...runMeta(result),
  });
}
export const runVrpOptimization = asyncHandler(performVrpOptimization);

export const runSpecificAlgorithm = (algorithm: AlgorithmId) => asyncHandler(async (req: AuthedRequest, res: Response) => {
  req.body.algorithm = algorithm;
  return performOptimization(req, res);
});

// ── benchmark ──────────────────────────────────────────────────────────────
const benchmarkSchema = z.object({
  customers: z.number().int().min(2).max(120).default(8),
  vehicleCount: z.number().int().min(1).max(20).default(3),
  depot: pointSchema.optional(),
  datasetSeed: z.number().int().default(26137),
  seeds: z.array(z.number().int()).min(1).max(10).optional(),
  algorithms: z.array(ALGO_ENUM).min(1).default(['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT']),
  populationSize: z.number().min(4).max(100).default(30),
  maxIterations: z.number().min(5).max(300).default(100),
  weights: weightsSchema.default({ ...DEFAULT_WEIGHTS }),
});

export const benchmark = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = benchmarkSchema.parse(req.body);
  const graph = getGraph();
  const depotId = body.depot ? graph.nearestNode(body.depot.lat, body.depot.lon) : 'pune-hub';
  if (!graph.nodes.has(depotId)) throw new ApiError(400, 'Unknown depot.', 'INVALID_INSTANCE');
  const ds = generateDataset(body.datasetSeed, body.customers, body.vehicleCount, graph, depotId, { startTimeMin: 540, capacityHeadroom: 1.4 });
  const problems = validateProblemInstance(ds.customers, ds.fleet, graph, depotId);
  if (problems.length) throw new ApiError(400, problems.join(' '), 'INVALID_INSTANCE');
  const base: RunParams = {
    graph, depotId, customers: ds.customers, fleet: ds.fleet, weights: body.weights as FitnessWeights, weather: { rainMm: 0, weatherSeverity: 0 },
    populationSize: body.populationSize, maxIterations: body.maxIterations, startTimeMin: 540,
  };
  const report = runBenchmark(base, { algorithms: body.algorithms, seeds: body.seeds ?? DEFAULT_SEEDS, datasetLabel: `Pune generated · ${body.customers} customers · ${body.vehicleCount} vehicles · dataset seed ${body.datasetSeed}` });
  setLastBenchmark(report);
  res.json({ success: true, ...report });
});

export const latestBenchmark = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const r = getLastBenchmark();
  res.json({ success: true, available: !!r, ...(r ?? {}) });
});

export const listAlgorithms = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({
    success: true, exactMaxCustomers: EXACT_MAX_CUSTOMERS, defaultSeeds: DEFAULT_SEEDS,
    algorithms: ALL_ALGORITHM_IDS.map((id) => ({ id, label: ALGORITHM_LABELS[id], defaults: id === 'QPSO' ? QPSO_DEFAULTS : id === 'AQPSO' ? { ...QPSO_DEFAULTS, ...ADAPTIVE_DEFAULTS } : id === 'PSO' ? PSO_DEFAULTS : id === 'GA' ? GA_DEFAULTS : {} })),
    note: 'QPSO / AQPSO are quantum-inspired classical algorithms — they run on ordinary CPUs and do not use quantum hardware.',
  });
});

export const getResult = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await getStore().getOptimizationResult(req.params.id);
  if (!result) throw new ApiError(404, 'Optimization result not found', 'NOT_FOUND');
  res.json({ success: true, result });
});

export const listResults = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ success: true, results: await getStore().listOptimizationResults(20) });
});
