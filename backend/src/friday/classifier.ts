/**
 * On-device intent classifier: TF-IDF (unigram + bigram) vectors, cosine-similarity k-NN over the labelled
 * utterances in trainingData.ts. Deterministic, dependency-free, runs offline. `extractSlots` then pulls
 * parameters (road code, vehicle, percent, weather, algorithms…) out of the raw text with rules.
 */
import { TRAINING, Example } from './trainingData';

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'me', 'please', 'to', 'of', 'in', 'on', 'it', 'this', 'that', 'do', 'does', 'my', 'we', 'you', 'i', 'and', 'for', 'now', 'right']);
const norm = (s: string) => s.toLowerCase().replace(/\br-?(\d+)\b/g, ' roadcode ').replace(/\bq-?\d{1,2}\b/g, ' vehicleid ').replace(/\d+(\.\d+)?/g, ' num ').replace(/[^a-z\s]/g, ' ');
const stem = (t: string) => (t.length > 5 ? t.replace(/(ing|ed|es|s)$/, '') : t.length > 3 ? t.replace(/s$/, '') : t);
function tokens(s: string): string[] {
  const w = norm(s).split(/\s+/).filter((t) => t && !STOP.has(t)).map(stem);
  const out = [...w]; for (let i = 0; i < w.length - 1; i++) out.push(`${w[i]}_${w[i + 1]}`);
  return out;
}

interface Doc { tool: string; vec: Map<string, number>; norm: number }
export class IntentClassifier {
  private idf = new Map<string, number>(); private docs: Doc[] = [];
  constructor(examples: Example[] = TRAINING) {
    const df = new Map<string, number>(); const toks = examples.map((e) => tokens(e.text));
    toks.forEach((t) => new Set(t).forEach((k) => df.set(k, (df.get(k) ?? 0) + 1)));
    const n = examples.length; df.forEach((c, k) => this.idf.set(k, Math.log((1 + n) / (1 + c)) + 1));
    this.docs = examples.map((e, i) => this.vectorize(e.tool, toks[i]));
  }
  private vectorize(tool: string, t: string[]): Doc {
    const tf = new Map<string, number>(); t.forEach((k) => tf.set(k, (tf.get(k) ?? 0) + 1));
    const vec = new Map<string, number>(); let sq = 0;
    tf.forEach((c, k) => { const w = (1 + Math.log(c)) * (this.idf.get(k) ?? Math.log(1 + this.docs.length) + 1); vec.set(k, w); sq += w * w; });
    return { tool, vec, norm: Math.sqrt(sq) || 1 };
  }
  classify(text: string, k = 3): { tool: string; score: number; runnerUp?: { tool: string; score: number } } {
    const q = this.vectorize('?', tokens(text));
    const sims = this.docs.map((d) => { let dot = 0; q.vec.forEach((w, key) => { const o = d.vec.get(key); if (o) dot += w * o; }); return { tool: d.tool, s: dot / (q.norm * d.norm) }; })
      .sort((a, b) => b.s - a.s).slice(0, k);
    const agg = new Map<string, number>(); sims.forEach((x) => agg.set(x.tool, (agg.get(x.tool) ?? 0) + x.s * x.s));
    const ranked = [...agg.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0]; if (!top || sims[0].s <= 0) return { tool: 'unknown', score: 0 };
    return { tool: top[0], score: sims[0].tool === top[0] ? sims[0].s : Math.sqrt(top[1] / k), runnerUp: ranked[1] ? { tool: ranked[1][0], score: Math.sqrt(ranked[1][1] / k) } : undefined };
  }
}

export interface Slots {
  road?: string; vehicleId?: string; percent?: number; condition?: string; algorithm?: string; algorithms?: string[];
  eventType?: string; demoAction?: string; scope?: 'ALL' | 'MAJOR';
}
const ALGO_PATTERNS: [RegExp, string][] = [[/\badaptive[\s-]*qpso\b|\baqpso\b/, 'AQPSO'], [/\bqpso\b/, 'QPSO'], [/\bpso\b/, 'PSO'], [/\bgenetic\b|\bga\b/, 'GA'], [/\bsimulated annealing\b|\bsa\b/, 'SA'], [/\bexact\b/, 'EXACT']];
export function extractSlots(text: string): Slots {
  const low = text.toLowerCase(); const s: Slots = {};
  const rc = text.match(/\bR-?(\d{2,4})\b/i); if (rc) s.road = `R-${rc[1]}`;
  else {
    const nm = text.match(/(?:on|of|at|along|closes?|closure|block(?:ed)?|closed)\s+(?:the\s+)?([A-Z][A-Za-z0-9–\- ]{2,40}?(?:Road|Highway|Bridge|Expressway|Marg|Path|Chowk|NH\d+))\b/) ?? text.match(/\b(NH\s?\d{2}|Pune[–-][A-Za-z]+ Highway|[A-Z][a-z]+ (?:Road|Highway))\b/);
    if (nm) s.road = nm[1].trim();
  }
  const v = low.match(/\bq-?(\d{1,2})\b/); if (v) s.vehicleId = `Q-${v[1].padStart(2, '0')}`;
  const p = low.match(/(\d{1,3})\s*(%|percent)/); if (p) s.percent = Number(p[1]);
  if (/\bstorm\b/.test(low)) s.condition = 'Storm'; else if (/\bfog\b/.test(low)) s.condition = 'Dense Fog'; else if (/\bheavy rain|\bheavily\b.*\brain|\brain\b.*\bheav/.test(low)) s.condition = 'Heavy Rain';
  else if (/\blight rain|drizzle/.test(low)) s.condition = 'Light Rain'; else if (/\brain/.test(low)) s.condition = 'Heavy Rain'; else if (/\bclear\b/.test(low)) s.condition = 'Clear Sky';
  const algos: string[] = []; let rest = low;
  for (const [re, id] of ALGO_PATTERNS) { const m = rest.match(re); if (m) { algos.push(id); rest = rest.replace(re, ' '); } }
  // keep textual order so "compare qpso and pso" → [QPSO, PSO]
  algos.sort((a, b) => low.search(ALGO_PATTERNS.find((x) => x[1] === a)![0]) - low.search(ALGO_PATTERNS.find((x) => x[1] === b)![0]));
  if (algos.length) { s.algorithm = algos[0]; s.algorithms = algos; }
  if (/\bbreak(s|ing)? ?down|broke down|broken|fail(s|ure|ed)?\b|unavailable|out of service/.test(low)) s.eventType = /unavailable|out of service/.test(low) ? 'VEHICLE_UNAVAILABLE' : 'VEHICLE_BREAKDOWN';
  else if (/\baccident|crash|collision/.test(low)) s.eventType = 'ACCIDENT';
  else if (/\bclos(e|es|ed|ure)|block(ed)?|shut/.test(low)) s.eventType = 'ROAD_CLOSURE';
  else if (/\btraffic|congestion|jam/.test(low) && (s.percent || /increas|rise|rises|surge|heav/.test(low))) s.eventType = 'TRAFFIC_INCREASE';
  else if (s.condition) s.eventType = 'WEATHER_CHANGE';
  if (/\bnetwork|whole city|everywhere|all roads\b/.test(low)) s.scope = 'ALL'; else if (/\bmajor|highway|arterial/.test(low) && s.eventType === 'TRAFFIC_INCREASE') s.scope = 'MAJOR';
  if (/\bpause\b/.test(low)) s.demoAction = 'pause'; else if (/\bresume|continue\b/.test(low)) s.demoAction = 'resume'; else if (/\breset|restart\b/.test(low)) s.demoAction = 'reset';
  else if (/\bwhat step|status|progress|where are we\b/.test(low)) s.demoAction = 'status'; else if (/\bstart|begin|run|launch\b/.test(low)) s.demoAction = 'start';
  return s;
}

let singleton: IntentClassifier | null = null;
export const classifier = () => (singleton ??= new IntentClassifier());
