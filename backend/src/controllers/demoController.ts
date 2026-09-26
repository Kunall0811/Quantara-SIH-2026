import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { demo, STEPS } from '../demo/sihDemo';
import { twin } from '../twin/engine';

export const state = asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ success: true, ...demo.state(), plan: twin.currentPlan, twin: twin.loaded ? twin.snapshot() : null });
});
export const catalog = asyncHandler(async (_req: AuthedRequest, res: Response) => { res.json({ success: true, steps: STEPS.map((s, i) => ({ index: i + 1, id: s.id, title: s.title })) }); });
export const start = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = z.object({ customers: z.number().int().min(4).max(30).optional(), vehicles: z.number().int().min(2).max(10).optional(), seed: z.number().int().optional(), delayMs: z.number().min(0).max(30000).optional(), auto: z.boolean().optional(), iterations: z.number().int().min(10).max(200).optional() }).parse(req.body ?? {});
  res.json({ success: true, ...(await demo.start(b)) });
});
export const pause = asyncHandler(async (_req: AuthedRequest, res: Response) => { res.json({ success: true, ...demo.pause() }); });
export const resume = asyncHandler(async (_req: AuthedRequest, res: Response) => { res.json({ success: true, ...demo.resume() }); });
export const reset = asyncHandler(async (_req: AuthedRequest, res: Response) => { res.json({ success: true, ...demo.reset() }); });
export const next = asyncHandler(async (_req: AuthedRequest, res: Response) => { res.json({ success: true, ...(await demo.next()) }); });
