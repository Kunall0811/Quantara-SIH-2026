/** Tool catalog + few-shot examples (drawn from trainingData.ts) shared by the Groq and Gemini tool-selection prompts. */
import { TRAINING } from './trainingData';

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  'twin.get_state': 'summary of the digital twin (network, fleet, deliveries, events, active plan)',
  'twin.optimize': 'compute a delivery plan on the twin. params: algorithm (QPSO|AQPSO|PSO|GA|SA)',
  'twin.what_if': 'DRY-RUN a disruption on a clone (never changes live state). params: eventType (ROAD_CLOSURE|ACCIDENT|TRAFFIC_INCREASE|VEHICLE_BREAKDOWN|WEATHER_CHANGE), road (e.g. R-142), vehicleId (Q-02), percent, condition',
  'twin.apply_event': 'APPLY a disruption to the live twin (needs confirmation). same params as twin.what_if',
  'twin.reoptimize': 're-plan on the changed network with minimal disruption. params: algorithm',
  'analysis.explain_route': 'why the current plan was chosen (objective breakdown)', 'analysis.route_dna': 'reproducible plan fingerprint',
  'analysis.resilience': 'resilience score from simulated scenarios', 'analysis.regret': 'regret vs the best alternative in hindsight',
  'analysis.time_windows': 'delivery time-window risk', 'analysis.counterfactual': 'with vs without re-optimization',
  'fleet.why_reassigned': 'why deliveries moved between vehicles. params: vehicleId (optional)',
  'benchmark.compare': 'compare two algorithms from the latest real benchmark. params: algorithms [A,B]', 'benchmark.explain': 'explain the latest benchmark',
  'scalability.explain': 'explain scalability testing', 'learning.summary': 'actual-vs-predicted ETA learning summary',
  'demo.control': 'SIH demo control. params: demoAction (start|pause|resume|reset|status)', 'algorithm.explain': 'explain QPSO/AQPSO/PSO/GA/SA/objective; QPSO is quantum-INSPIRED, not quantum computing',
  'system.self_check': 'run real self-diagnostics of every subsystem',
};

export function fewShot(toolNames: string[], perTool = 2): string {
  const seen = new Map<string, number>(); const lines: string[] = [];
  for (const e of TRAINING) {
    if (!toolNames.includes(e.tool)) continue;
    const n = seen.get(e.tool) ?? 0; if (n >= perTool) continue; seen.set(e.tool, n + 1);
    lines.push(`"${e.text}" -> {"tool":"${e.tool}"}`);
  }
  return lines.join('\n');
}

export function toolSelectionPrompt(toolNames: string[]): string {
  const desc = toolNames.filter((t) => TOOL_DESCRIPTIONS[t]).map((t) => `- ${t}: ${TOOL_DESCRIPTIONS[t]}`).join('\n');
  return `You are FRIDAY, the tool-selection layer of QUANTARA, a quantum-inspired transportation digital-twin platform (quantum-inspired means classical algorithms; it is NOT quantum computing).
Pick the single best tool for the command and extract its parameters. Road codes look like R-142, vehicles like Q-01.
Tools needing explanation:\n${desc}
Examples:\n${fewShot(toolNames)}
Respond with ONLY a JSON object {"tool":"<tool_name>","parameters":{...}}. If nothing fits respond {"tool":"unknown","parameters":{}}. No other text, no markdown.`;
}
