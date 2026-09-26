import { Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { getStore, dbStatus } from '../store';
import { checkTomtomHealth } from '../providers/tomtom';
import { checkOsrmHealth } from '../providers/osrm';
import { checkOpenMeteoHealth, checkNominatimHealth } from '../providers/freeProviders';
import { checkGroqHealth } from '../providers/groq';
import { emailConfigured } from '../services/emailService';
import { liveTrafficSummary } from '../services/graphService';

export const dashboard = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const users = await store.listUsers();
  const incidents = await store.listActiveIncidents();
  const results = await store.listOptimizationResults(100);
  const byAlgo: Record<string, number> = {};
  for (const r of results) byAlgo[r.algorithm] = (byAlgo[r.algorithm] || 0) + 1;

  res.json({
    success: true,
    totalUsers: users.length,
    activeIncidents: incidents.length,
    totalOptimizationRuns: results.length,
    runsByAlgorithm: byAlgo,
    traffic: liveTrafficSummary(),
    database: dbStatus(),
  });
});

export const listUsers = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const users = await store.listUsers();
  res.json({ success: true, users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: u.emailVerified, createdAt: u.createdAt })) });
});

export const adminRoutes = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const results = await store.listOptimizationResults(50);
  res.json({ success: true, results });
});

export const adminTraffic = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const incidents = await store.listActiveIncidents();
  res.json({ success: true, summary: liveTrafficSummary(), incidents });
});

export const adminOptimization = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const results = await store.listOptimizationResults(100);
  const avgByAlgo: Record<string, { count: number; avgFitness: number; avgRuntime: number }> = {};
  for (const r of results) {
    if (!avgByAlgo[r.algorithm]) avgByAlgo[r.algorithm] = { count: 0, avgFitness: 0, avgRuntime: 0 };
    const bucket = avgByAlgo[r.algorithm];
    bucket.avgFitness = (bucket.avgFitness * bucket.count + r.bestFitness) / (bucket.count + 1);
    bucket.avgRuntime = (bucket.avgRuntime * bucket.count + r.runtimeSeconds) / (bucket.count + 1);
    bucket.count += 1;
  }
  res.json({ success: true, comparison: avgByAlgo });
});

export const health = asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.json({ success: true, status: 'ok', database: dbStatus(), timestamp: new Date().toISOString() });
});

export const healthDatabase = asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...dbStatus() });
});

export const healthFull = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { runSelfChecks } = await import('../services/selfCheck');
  const { overall, checks } = await runSelfChecks();
  res.json({ success: overall !== 'FAIL', overall, timestamp: new Date().toISOString(), database: dbStatus(), checks,
    note: 'Every check executes the subsystem on a tiny instance; nothing is reported PASS without running.' });
});

export const healthServices = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const [tomtom, osrm, openMeteo, nominatim, groq] = await Promise.all([
    checkTomtomHealth(), checkOsrmHealth(), checkOpenMeteoHealth(), checkNominatimHealth(), checkGroqHealth(),
  ]);
  res.json({
    success: true,
    tomtom, osrm, openMeteo, nominatim, groq,
    smtp: emailConfigured() ? 'configured' : 'not_configured (OTPs logged to console)',
    database: dbStatus().backend,
  });
});
