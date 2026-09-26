import fs from 'fs';
import path from 'path';

/** Tiny file persistence (JSON documents + JSONL logs) so learning data, plans and benchmark evidence
 *  survive restarts even when MongoDB is not configured. Never throws — failures degrade to memory-only. */
export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}
function ensure(): boolean {
  try { fs.mkdirSync(dataDir(), { recursive: true }); return true; } catch { return false; }
}
export function saveJson(name: string, obj: unknown): boolean {
  if (!ensure()) return false;
  try {
    const f = path.join(dataDir(), `${name}.json`); const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, f); return true;
  } catch { return false; }
}
export function loadJson<T>(name: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), `${name}.json`), 'utf8')) as T; } catch { return null; }
}
export function appendJsonl(name: string, obj: unknown): boolean {
  if (!ensure()) return false;
  try { fs.appendFileSync(path.join(dataDir(), `${name}.jsonl`), JSON.stringify(obj) + '\n'); return true; } catch { return false; }
}
export function readJsonl<T>(name: string): T[] {
  try {
    return fs.readFileSync(path.join(dataDir(), `${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch { return []; }
}
export function removeData(name: string) {
  for (const ext of ['json', 'jsonl']) { try { fs.unlinkSync(path.join(dataDir(), `${name}.${ext}`)); } catch { /* ignore */ } }
}
