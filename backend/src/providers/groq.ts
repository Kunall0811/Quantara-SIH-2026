import { env } from '../config/env';
import { toolSelectionPrompt } from '../friday/prompt';

const SYSTEM_PROMPT = `You are FRIDAY, an advanced predictive AI reasoning layer and tool-selection engine for the Q-ROUTE INDIA citizen transportation assistant.
Given a command and the list of available tools, you must predict the best course of action.
Analyze the user's intent carefully. For example, if they mention heavy traffic, consider triggering traffic analysis or a reroute. 
Respond with ONLY a JSON object of the form {"tool": "<tool_name>", "parameters": {...}} choosing the single best-matching tool.
If nothing matches, respond {"tool": "unknown", "parameters": {}}. Never include any other text, explanation, or markdown formatting.`;

export function groqConfigured(): boolean {
  return !!env.GROQ_API_KEY;
}

export async function groqSelectTool(command: string, toolNames: string[]): Promise<{ tool: string; parameters: any } | null> {
  if (!groqConfigured()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages: [
          { role: 'system', content: toolSelectionPrompt(toolNames) },
          { role: 'user', content: `Available tools: ${toolNames.join(', ')}\nCommand: ${command}` },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim().replace(/```json|```/g, '');
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Turns a raw tool result into a short, natural spoken/text reply. Falls back to a templated reply (see friday/replies.ts) when Groq isn't configured or fails. */
export async function groqSummarize(prompt: string): Promise<string | null> {
  if (!groqConfigured()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are FRIDAY, a concise, calm, professional transportation assistant for Q-ROUTE INDIA. Reply in 1-2 short sentences, no markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 120,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function checkGroqHealth(): Promise<'healthy' | 'not_configured' | 'unreachable'> {
  if (!groqConfigured()) return 'not_configured';
  const result = await groqSummarize('Say "ok".');
  return result ? 'healthy' : 'unreachable';
}

export async function groqAnswer(command: string, context: string): Promise<string | null> {
  if (!groqConfigured()) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are FRIDAY, an advanced transportation operations AI. Answer the user naturally and accurately using ONLY the supplied live context for operational facts. You can explain algorithms, logistics, routing, fleet tracking, traffic, weather, optimization and general questions. Never claim an external fact is live unless it appears in context. QPSO and Adaptive QPSO are quantum-inspired classical algorithms; never say QUANTARA uses quantum hardware. Never invent numbers. If a value is unavailable, say so. Keep answers concise but useful (2-5 sentences). No markdown tables.' },
          { role: 'user', content: `LIVE CONTEXT:\n${context}\n\nUSER REQUEST:\n${command}` },
        ], temperature: 0.25, max_tokens: 260 }), signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}
