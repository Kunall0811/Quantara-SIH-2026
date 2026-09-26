import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { resolvePlan } from '../friday/intent';
import { TOOLS } from '../friday/tools';
import { TWIN_ADMIN_TOOLS } from '../friday/twinTools';
import { templatedReply } from '../friday/replies';
import { groqSummarize, groqAnswer, groqConfigured, checkGroqHealth } from '../providers/groq';
import { geminiSummarize, geminiAnswer, geminiConfigured, checkGeminiHealth } from '../providers/gemini';
import { getFleetVehicles } from '../services/fleetTracker';
import { getNetworkTrafficSummary } from '../services/trafficManager';
import { getStore } from '../store';
import { synthesizeSpeech, ttsProvider } from '../services/ttsService';
import { env } from '../config/env';

const chatSchema = z.object({ text: z.string().min(1), sessionId: z.string().default('default'), confirmed: z.boolean().default(false), language: z.enum(['en', 'hi', 'mr']).default('en') });

export const chat = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { text, sessionId, confirmed, language } = chatSchema.parse(req.body);
  const store = getStore();
  await store.logConversation({ userId: req.user?.sub || null, sessionId, role: 'user', text });

  const plan = await resolvePlan(text);
  const adminOnlyTools = new Set([
    'optimization.run', 'optimization.benchmark', 'optimization.convergence',
    'incidents.create_incident', 'incidents.resolve_incident', 'incidents.create_at_address', 'fleet.reroute_vehicle', 'fleet.reroute_all_delayed',
    ...TWIN_ADMIN_TOOLS,
  ]);
  if (req.user?.role !== 'admin' && adminOnlyTools.has(plan.tool)) {
    const reply = 'That command is available only to the QUANTARA administrator.';
    await store.logConversation({ userId: req.user?.sub || null, sessionId, role: 'assistant', text: reply, intent: plan.intent });
    return res.json({ success: true, text: reply, intent: plan.intent, tool: plan.tool, status: 'FORBIDDEN', data: {} });
  }
  let status = 'SUCCESS';
  let data: any = {};
  let reply: string;

  if (plan.tool === 'unknown') {
    // Keep the offline rule engine truly offline: do not block an unknown
    // command on remote weather/LLM calls. Live context is gathered only
    // when an AI provider is actually configured.
    if (!geminiConfigured() && !groqConfigured()) {
      status = 'UNKNOWN';
      reply = 'I do not recognize that command. Try asking about traffic, fleet status, the digital twin, what-if scenarios, resilience, benchmarks, optimization, incidents, weather, ETA, or route decisions.';
      await store.logConversation({ userId: req.user?.sub || null, sessionId, role: 'assistant', text: reply, intent: plan.intent });
      await store.writeAudit({ userId: req.user?.sub || null, action: 'FRIDAY:unknown', details: { text, status } });
      return res.json({ success: true, text: reply, intent: plan.intent, tool: plan.tool, status, data: {}, requiresConfirmation: false });
    }
    const [traffic, fleet, recent, incidents, weather] = await Promise.all([getNetworkTrafficSummary(), Promise.resolve(getFleetVehicles()), store.listConversation(sessionId, 8), store.listActiveIncidents(), import('../providers/freeProviders').then(m => m.getWeather(18.5204, 73.8567))]);
    const condition = traffic.source === 'SIMULATED' ? traffic.weather.condition : undefined;
    const roadHealthIndex = traffic.source === 'SIMULATED' ? traffic.roadHealthIndex : undefined;
    const liveContext = JSON.stringify({ now: new Date().toISOString(), weather: { ...weather, condition, roadHealthIndex }, traffic: { avgCongestionPct: traffic.avgCongestionPct, roadHealthIndex }, fleet: fleet.map(v => ({ id: v.id, lat: v.lat, lon: v.lon, speed: v.speed, status: v.status, eta: v.eta, road: v.matchedRoad, progress: v.routeProgressPct, source: v.locationSource, gpsAt: v.lastGpsAt })), recentConversation: recent.map(x => ({ role: x.role, text: x.text })), adminIncidents: incidents.map(i => ({type:i.type,lat:i.lat,lon:i.lon,severity:i.severity,description:i.description})) });
    let aiReply: string | null = null;
    if (geminiConfigured()) {
      aiReply = await geminiAnswer(text, liveContext);
    }
    if (!aiReply && groqConfigured()) {
      aiReply = await groqAnswer(text, liveContext);
    }
    if (aiReply) { reply = aiReply; data = { liveContext: true }; status = 'SUCCESS'; }
    else { status = 'UNKNOWN'; reply = "I can answer operational questions when the AI provider is configured, or use the built-in fleet, traffic, weather and optimization commands."; }
  } else if (plan.tool.startsWith('optimization.')) {
    data = { navigate: 'plan', suggestedAction: plan.tool, action: { type: 'NAVIGATE', page: 'plan', command: plan.tool === 'optimization.run' ? 'RUN_OPTIMIZATION' : null } };
    reply = plan.tool === 'optimization.run' ? 'Opening the optimizer and starting the selected optimization command.'
      : plan.tool === 'optimization.benchmark' ? 'Opening benchmarking. I will run the comparison when you start it.'
      : 'Opening the optimization workspace for the latest convergence data.';
  } else if (plan.requiresConfirmation && !confirmed) {
    status = 'PENDING_CONFIRMATION';
    data = { pendingTool: plan.tool, pendingParameters: plan.parameters };
    reply = plan.tool === 'twin.apply_event' ? 'This will change the live digital twin (network or fleet state). Should I proceed?' : 'This will change live traffic state. Should I proceed?';
  } else {
    try {
      data = await TOOLS[plan.tool](plan.parameters);
    } catch (err: any) {
      status = 'ERROR';
      data = { error: err.message };
    }
    let aiSummary: string | null = null;
    // Grounded tools already carry an exact, data-derived reply — never let an LLM re-word (and possibly alter) the numbers.
    const grounded = !!(data && data.grounded && typeof data.reply === 'string');
    const summaryPrompt = `Command: "${text}". Tool result: ${JSON.stringify(data).slice(0, 500)}. Reply naturally in 1-2 short sentences.`;
    if (!grounded && geminiConfigured()) {
      aiSummary = await geminiSummarize(summaryPrompt);
    }
    if (!grounded && !aiSummary && groqConfigured()) {
      aiSummary = await groqSummarize(summaryPrompt);
    }
    reply = grounded ? data.reply : (aiSummary || templatedReply(plan.tool, status, data));
    if (status === 'SUCCESS' && data?.error && typeof data.reply === 'string') reply = data.reply;
  }

  if (language === 'hi' && !groqConfigured() && !geminiConfigured()) {
    // Offline fallback can't translate; note this honestly rather than pretending.
    reply = `${reply} (Hindi/Marathi replies need GROQ_API_KEY or GEMINI_API_KEY configured — showing English.)`;
  }

  await store.logConversation({ userId: req.user?.sub || null, sessionId, role: 'assistant', text: reply, intent: plan.intent });
  await store.writeAudit({ userId: req.user?.sub || null, action: `FRIDAY:${plan.tool}`, details: { text, status } });

  res.json({ success: true, text: reply, intent: plan.intent, tool: plan.tool, status, data, requiresConfirmation: status === 'PENDING_CONFIRMATION' });
});

export const action = asyncHandler(async (req: AuthedRequest, res: Response) => {
  req.body.confirmed = true;
  return chat(req, res, () => {});
});

export const ttsHandler = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const text = (req.query.text as string) || (req.body?.text as string) || '';
  const result = await synthesizeSpeech(text);
  if (result.audio) {
    res.setHeader('Content-Type', result.contentType || 'audio/mpeg');
    return res.send(result.audio);
  }
  res.json({ provider: 'browser', text });
});

export const status = asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.json({
    success: true,
    enabled: true,
    wakeWord: 'FRIDAY',
    llm: geminiConfigured() ? 'gemini' : groqConfigured() ? 'groq' : 'rule_engine_only',
    llmHealth: geminiConfigured() ? await checkGeminiHealth() : await checkGroqHealth(),
    voiceOutput: ttsProvider(),
    voiceInput: env.STT_PROVIDER,
    toolsAvailable: Object.keys(TOOLS).length + 3,
  });
});

export const history = asyncHandler(async (req: AuthedRequest, res: Response) => {
  const store = getStore();
  const sessionId = (req.query.sessionId as string) || 'default';
  const conv = await store.listConversation(sessionId, 50);
  res.json({ success: true, conversation: conv });
});
