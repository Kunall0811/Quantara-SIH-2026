import { Response } from 'express';
import { z } from 'zod';
import os from 'os';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { getGraph } from '../services/graphService';
import { DEFAULT_WEIGHTS, VrpEvaluation } from '../optimization/fitness';
import { generateDataset } from '../optimization/datasetGenerator';
import { runAlgorithm, RunParams } from '../optimization';
import { EXACT_MAX_CUSTOMERS } from '../optimization/exactSolver';

export const SCALABILITY_SIZES = [10, 25, 50, 100, 250, 500];

const scalabilitySchema = z.object({
  depotLat: z.number().optional(), depotLon: z.number().optional(),
  seed: z.number().default(26137),
  customerCounts: z.array(z.number().int().min(1).max(2000)).default(SCALABILITY_SIZES),
  algorithms: z.array(z.enum(['QPSO', 'AQPSO', 'PSO', 'GA', 'SA'])).default(['QPSO']),
  vehicleCount: z.number().int().min(1).max(50).default(8),
  populationSize: z.number().min(4).max(200).default(30),
  maxIterations: z.number().min(5).max(500).default(100),
  /** a size is NOT EXECUTED if its predicted runtime exceeds this (seconds) */
  perRunLimitSeconds: z.number().min(1).max(600).default(60),
});

/**
 * Measured, never estimated: each row is a real optimizer run. When the runtime that the previous
 * measurements predict for a bigger size exceeds `perRunLimitSeconds`, the row is reported as
 * NOT EXECUTED with the prediction shown — we do not fabricate a number for it.
 */
export const runScalability = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = scalabilitySchema.parse(req.body ?? {});
  const graph = getGraph();
  const depotId = body.depotLat !== undefined && body.depotLon !== undefined ? graph.nearestNode(body.depotLat, body.depotLon) : 'pune-hub';
  const sizes = [...body.customerCounts].sort((a, b) => a - b);
  const rows: any[] = [];
  const last = new Map<string, { n: number; s: number }>();

  for (const n of sizes) {
    const ds = generateDataset(body.seed, n, body.vehicleCount, graph, depotId, { startTimeMin: 540, capacityHeadroom: 1.5 });
    for (const algorithm of body.algorithms) {
      const prev = last.get(algorithm);
      const predicted = prev ? prev.s * Math.pow(n / prev.n, 1.3) : 0;            // super-linear extrapolation from the last measurement
      if (predicted > body.perRunLimitSeconds) {
        rows.push({ customers: n, algorithm, status: 'NOT EXECUTED', reason: `computationally impractical within the ${body.perRunLimitSeconds}s per-run limit (extrapolated ≈ ${predicted.toFixed(0)}s from the N=${prev!.n} measurement)`, predictedSeconds: Number(predicted.toFixed(1)) });
        continue;
      }
      const params: RunParams = { graph, depotId, customers: ds.customers, fleet: ds.fleet, weights: DEFAULT_WEIGHTS, weather: { rainMm: 0, weatherSeverity: 0 }, populationSize: body.populationSize, maxIterations: body.maxIterations, seed: body.seed, startTimeMin: 540 };
      const m0 = process.memoryUsage().heapUsed;
      const r = runAlgorithm(algorithm, params);
      const m1 = process.memoryUsage().heapUsed;
      const ev = r.bestEval as VrpEvaluation;
      last.set(algorithm, { n, s: r.runtimeSeconds });
      rows.push({
        customers: n, algorithm, status: 'MEASURED', runtimeSeconds: Number(r.runtimeSeconds.toFixed(3)), bestFitness: Number(r.bestFitness.toFixed(3)), feasible: r.feasible,
        iterations: r.iterations, evaluations: r.evaluations, vehiclesUsed: ev.routes.length, unassigned: ev.unassigned.length, distanceKm: Number(ev.distanceKm.toFixed(1)),
        heapDeltaMB: Number(((m1 - m0) / 1048576).toFixed(1)), seed: body.seed, populationSize: body.populationSize, maxIterations: body.maxIterations,
      });
    }
    rows.push({ customers: n, algorithm: 'EXACT', status: n <= EXACT_MAX_CUSTOMERS ? 'AVAILABLE (run via /optimization/exact or benchmark)' : 'NOT EXECUTED', reason: n <= EXACT_MAX_CUSTOMERS ? undefined : `exhaustive search is computationally impractical for N=${n} (${n}! permutations; limit N ≤ ${EXACT_MAX_CUSTOMERS})` });
  }
  const measured = rows.filter((r) => r.status === 'MEASURED');
  res.json({
    success: true, results: rows.filter((r) => r.algorithm !== 'EXACT' || r.status !== 'AVAILABLE (run via /optimization/exact or benchmark)'),
    hardware: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, totalMemGB: Number((os.totalmem() / 1073741824).toFixed(1)), node: process.version, platform: `${process.platform}/${process.arch}` },
    method: `Each MEASURED row is one real run (seed ${body.seed}, N=${body.populationSize}, ${body.maxIterations} iterations) on the ${graph.nodes.size}-node Pune-centred road graph with a shared, cached shortest-path oracle. Wall-clock time includes decoding, routing and constraint checks.`,
    summary: measured.length ? { largestMeasured: Math.max(...measured.map((m) => m.customers)), notExecuted: rows.filter((r) => r.status === 'NOT EXECUTED').length } : null,
  });
});
