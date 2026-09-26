import { env } from '../config/env';
import { toolSelectionPrompt } from '../friday/prompt';

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export async function checkGeminiHealth(): Promise<'OK' | 'UNCONFIGURED' | 'ERROR'> {
  if (!geminiConfigured()) return 'UNCONFIGURED';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });
    return res.ok ? 'OK' : 'ERROR';
  } catch {
    return 'ERROR';
  }
}

export async function geminiAnswer(prompt: string, liveContext: string): Promise<string | null> {
  if (!geminiConfigured()) return null;
  const systemPrompt = "You are F.R.I.D.A.Y., the advanced AI operations voice assistant for QUANTARA traffic fleet intelligence. Answer concisely, intelligently, and operationally like Iron Man's AI assistant. Perform dynamic predictions on weather, road congestion, and optimal route strategies. QPSO and Adaptive QPSO are quantum-inspired classical algorithms; never claim quantum hardware. Never invent numbers not in the live context. Do not use markdown (no asterisks or hash symbols) because this text will be read aloud by a TTS engine.";
  
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
            { role: "user", parts: [{ text: `Live Context:\n${liveContext}\n\nUser: ${prompt}` }] }
        ]
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Gemini API Non-OK Response (Answer):', res.status, errorText);
      return null;
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('Gemini API Error:', err);
    return null;
  }
}

export async function geminiSummarize(text: string): Promise<string | null> {
  if (!geminiConfigured()) return null;
  const systemPrompt = "Summarize the tool output into a single short sentence like F.R.I.D.A.Y. No markdown (no asterisks).";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [ { role: "user", parts: [{ text }] } ]
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Gemini API Non-OK Response (Summarize):', res.status, errorText);
      return null;
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    return null;
  }
}

const TOOL_SYSTEM_PROMPT = `You are FRIDAY, an advanced predictive AI reasoning layer and tool-selection engine for the Q-ROUTE INDIA citizen transportation assistant.
Given a command and the list of available tools, you must predict the best course of action.
Analyze the user's intent carefully. For example, if they mention heavy traffic, consider triggering traffic analysis or a reroute. 
Respond with ONLY a JSON object of the form {"tool": "<tool_name>", "parameters": {...}} choosing the single best-matching tool.
If nothing matches, respond {"tool": "unknown", "parameters": {}}. Never include any other text, explanation, or markdown formatting.`;

export async function geminiSelectTool(command: string, toolNames: string[]): Promise<{ tool: string; parameters: any } | null> {
  if (!geminiConfigured()) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: toolSelectionPrompt(toolNames) }] },
        contents: [
          { role: 'user', parts: [{ text: `Available tools: ${toolNames.join(', ')}\nCommand: ${command}` }] }
        ],
        generationConfig: { temperature: 0 }
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Gemini API Non-OK Response (SelectTool):', res.status, errorText);
      return null;
    }
    const data = (await res.json()) as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().replace(/```json|```/g, '');
    return text ? JSON.parse(text) : null;
  } catch (err) {
    return null;
  }
}
