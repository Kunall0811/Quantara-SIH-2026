import { TOOLS, isWriteTool } from './tools';
import { groqSelectTool, groqConfigured } from '../providers/groq';
import { geminiSelectTool, geminiConfigured } from '../providers/gemini';
import { classifier, extractSlots } from './classifier';
import { TWIN_WRITE_TOOLS } from './twinTools';

export interface Plan {
  tool: string;
  parameters: any;
  intent: string;
  confidence: number;
  requiresConfirmation: boolean;
}

const NEW_TOOL = /^(twin|analysis|benchmark|scalability|learning|demo|algorithm)\.|^fleet\.why_reassigned$|^system\.self_check$/;

/** Trained on-device classifier + slot extraction (see friday/classifier.ts). Works with no network / LLM. */
export function classifyPlan(text: string, minScore = 0.5): Plan | null {
  const c = classifier().classify(text);
  if (c.tool === 'unknown' || c.score < minScore || !TOOLS[c.tool]) return null;
  const slots = extractSlots(text);
  return { tool: c.tool, parameters: { ...slots, raw: text }, intent: `CLASSIFIER:${c.tool}`, confidence: Number(c.score.toFixed(2)), requiresConfirmation: isWriteTool(c.tool) || TWIN_WRITE_TOOLS.includes(c.tool) };
}

export async function resolvePlan(text: string): Promise<Plan> {
  const low = text.toLowerCase();
  
  if (geminiConfigured()) {
    const result = await geminiSelectTool(text, Object.keys(TOOLS));
    if (result && TOOLS[result.tool]) return { tool: result.tool, parameters: { ...extractSlots(text), raw: text, ...(result.parameters || {}) }, intent: 'GEMINI_RESOLVED', confidence: 0.95, requiresConfirmation: isWriteTool(result.tool) };
  }
  
  if (groqConfigured()) {
    const result = await groqSelectTool(text, Object.keys(TOOLS));
    if (result && TOOLS[result.tool]) return { tool: result.tool, parameters: { ...extractSlots(text), raw: text, ...(result.parameters || {}) }, intent: 'GROQ_RESOLVED', confidence: 0.95, requiresConfirmation: isWriteTool(result.tool) };
  }

  // Trained classifier: twin / analysis / benchmark / learning / demo / algorithm intents beat the generic legacy fallbacks.
  const cls = classifyPlan(text);
  if (cls && NEW_TOOL.test(cls.tool)) return cls;

  // Deterministic fallback for traffic questions must run before generic panel
  // navigation so "what is the traffic status?" is answered with live state.
  if (/\b(what is|whats|show|give|tell).*\btraffic\b.*\b(status|condition|level)\b/.test(low) || /\btraffic status\b/.test(low)) {
    return { tool: 'traffic.get_current_status', parameters: {}, intent: 'GET_TRAFFIC_STATUS', confidence: 0.9, requiresConfirmation: false };
  }
  if (/\btraffic\b/.test(low)) return { tool: 'navigation.open', parameters: { page: 'traffic' }, intent: 'OPEN_TRAFFIC', confidence: 0.6, requiresConfirmation: false };
  if (/\boptimi[sz]e\b/.test(low)) return { tool: 'optimization.run', parameters: {}, intent: 'RUN_OPTIMIZATION', confidence: 0.6, requiresConfirmation: false };
  if (/\bbenchmark(ing)?\b/.test(low)) return { tool: 'optimization.benchmark', parameters: {}, intent: 'OPEN_BENCHMARK', confidence: 0.6, requiresConfirmation: false };
  if (/\bconvergence\b/.test(low)) return { tool: 'optimization.convergence', parameters: {}, intent: 'OPEN_CONVERGENCE', confidence: 0.6, requiresConfirmation: false };
  if (/\baccident\b|\bclosure\b/.test(low)) return { tool: 'incidents.create_incident', parameters: { incidentType: 'ACCIDENT' }, intent: 'SIMULATE_ACCIDENT', confidence: 0.6, requiresConfirmation: true };
  if (/\b(assign|dispatch)\b.*\b(to|at)\b/.test(low)) {
    const match = low.match(/(q-\d{2})/);
    return { tool: 'fleet.assign_task', parameters: { vehicleId: match ? match[1].toUpperCase() : 'Q-01', destination: 'Hinjewadi' }, intent: 'ASSIGN_TASK', confidence: 0.7, requiresConfirmation: true };
  }
  if (/\bsimulate\b.*\b(rain|weather|fog|storm)\b/.test(low)) return { tool: 'weather.simulate_weather', parameters: { condition: 'HEAVY_RAIN' }, intent: 'SIMULATE_WEATHER', confidence: 0.8, requiresConfirmation: true };
  if (/\bfleet\b.*\bstatus\b/.test(low)) return { tool: 'fleet.list', parameters: {}, intent: 'GET_FLEET_STATUS', confidence: 0.8, requiresConfirmation: false };
  if (/\b(start|begin|launch)\b.*\b(mission|delivery|tracking)\b/.test(low)) return { tool: 'navigation.open', parameters: { page: 'plan', action: 'START_MISSION' }, intent: 'START_MISSION', confidence: 0.6, requiresConfirmation: false };
  if (/\b(stop|pause|end)\b.*\b(mission|delivery|tracking)\b/.test(low)) return { tool: 'navigation.open', parameters: { page: 'plan', action: 'STOP_MISSION' }, intent: 'STOP_MISSION', confidence: 0.6, requiresConfirmation: false };
  if (/\b(day|night|dark|light)\b.*\bmap\b/.test(low) || /\bmap\b.*\b(day|night|dark|light)\b/.test(low)) {
    const mode = /\b(day|light)\b/.test(low) ? 'day' : 'night';
    return { tool: 'map.set_mode', parameters: { mode }, intent: 'SET_MAP_MODE', confidence: 0.8, requiresConfirmation: false };
  }

  if (/\b(my eta|my delivery|my package|where is my)\b/.test(low) || (/\b(delayed|status|eta)\b/.test(low) && /\bmy\b/.test(low))) {
    return { tool: 'citizen.delivery_status', parameters: {}, intent: 'CITIZEN_STATUS', confidence: 0.9, requiresConfirmation: false };
  }

  const panelMatch = low.match(/\b(show|open|go to|view)\s+(dashboard|command center|notifications|settings|plan|optimize|traffic|assign|weather|benchmark(ing)?|scalability|history|reports|analytics)\b/);
  if (panelMatch) {
    const target = panelMatch[2];
    let page = 'dashboard';
    if (target === 'command center') page = 'dashboard';
    else if (target.includes('benchmark')) page = 'benchmarking';
    else if (target === 'optimize' || target === 'plan') page = 'plan';
    else if (target === 'reports' || target === 'analytics') page = 'history';
    else if (target === 'assign') page = 'assign-task';
    else page = target;
    return { tool: 'navigation.open', parameters: { page }, intent: 'OPEN_PANEL', confidence: 0.8, requiresConfirmation: false };
  }

  const late = classifyPlan(text, 0.55);
  if (late) return late;
  return { tool: 'unknown', parameters: {}, intent: 'UNKNOWN', confidence: 0, requiresConfirmation: false };
}
