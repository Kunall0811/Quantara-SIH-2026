import { RoadGraph } from './graph';

export interface LegStats {
  cost: number;            // minutes (time weight) — Infinity if unreachable
  nodePath: string[];
  edgePath: string[];
  distanceKm: number;
  freeFlowMin: number;
  congestionSum: number;
  riskSum: number;
  edgeCount: number;
  reachable: boolean;
}

/**
 * Memoises shortest-path queries and their aggregate leg statistics for ONE
 * optimization run. The road graph is treated as immutable for the lifetime of
 * an oracle, so results are identical to calling the graph directly — only faster.
 * (Create a new oracle after any traffic/closure change.)
 */
export class RouteOracle {
  private cache = new Map<string, LegStats>();
  hits = 0; misses = 0;
  constructor(public readonly graph: RoadGraph) {}

  leg(source: string, target: string, algo: 'dijkstra' | 'astar' = 'dijkstra'): LegStats {
    const key = `${algo}|${source}|${target}`;
    const c = this.cache.get(key);
    if (c) { this.hits++; return c; }
    this.misses++;
    const r = this.graph.shortest(source, target, algo, 'time');
    let distanceKm = 0, freeFlowMin = 0, congestionSum = 0, riskSum = 0;
    for (const eid of r.edgePath) {
      const e = this.graph.edges.get(eid)!;
      distanceKm += e.distanceKm;
      freeFlowMin += (e.distanceKm / e.baseSpeedKmph) * 60;
      congestionSum += e.congestionPct;
      riskSum += e.riskScore;
    }
    const stats: LegStats = {
      cost: r.cost, nodePath: r.nodePath, edgePath: r.edgePath, distanceKm, freeFlowMin,
      congestionSum, riskSum, edgeCount: r.edgePath.length,
      reachable: r.cost !== Infinity && r.nodePath.length > 0,
    };
    this.cache.set(key, stats);
    return stats;
  }

  /** Same shape as RoadGraph.shortest — lets legacy callers use an oracle transparently. */
  shortest(source: string, target: string, algo: 'dijkstra' | 'astar' = 'dijkstra', _weight: 'time' | 'distance' = 'time') {
    const l = this.leg(source, target, algo);
    return { cost: l.cost, nodePath: l.nodePath, edgePath: l.edgePath };
  }
}
