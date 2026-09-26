import { RoadGraph, GraphEdge } from '../optimization/graph';

/** Stable short road codes (R-101 …) for every physical road (both directions share a code). */
export function roadCodeMap(graph: RoadGraph): Map<string, string> {
  const m = new Map<string, string>(); let i = 0;
  for (const id of graph.edges.keys()) {
    if (id.endsWith('_r')) continue;
    m.set(id, `R-${101 + i++}`);
  }
  return m;
}
export function baseId(edgeId: string) { return edgeId.endsWith('_r') ? edgeId.slice(0, -2) : edgeId; }

export function codeOf(graph: RoadGraph, edgeId: string): string | null { return roadCodeMap(graph).get(baseId(edgeId)) ?? null; }

/** Resolve an edge id | road code | road-name fragment to the physical road (both directional edge ids). */
export function resolveRoad(graph: RoadGraph, ref: string): { base: string; ids: string[]; code: string | null; name: string } | null {
  const q = ref.trim();
  if (!q) return null;
  const codes = roadCodeMap(graph);
  let base: string | undefined;
  if (graph.edges.has(q)) base = baseId(q);
  else {
    const up = q.toUpperCase().replace(/^ROAD\s+/, '');
    for (const [id, c] of codes) if (c === up) { base = id; break; }
    if (!base) {
      const low = q.toLowerCase();
      const cands = [...graph.edges.values()].filter((e) => !e.id.endsWith('_r') && e.name.toLowerCase().includes(low));
      cands.sort((a, b) => Number(b.id.startsWith('pune-')) - Number(a.id.startsWith('pune-')) || a.id.localeCompare(b.id));
      base = cands[0]?.id;
    }
  }
  if (!base) return null;
  const e = graph.edges.get(base) as GraphEdge;
  const ids = [base]; if (graph.edges.has(base + '_r')) ids.push(base + '_r');
  return { base, ids, code: codes.get(base) ?? null, name: e.name };
}
