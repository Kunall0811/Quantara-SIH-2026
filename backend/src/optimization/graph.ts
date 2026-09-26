/**
 * Road network graph model: G = (V, E). Mirrors the design used across the
 * project - traffic level directly scales an edge's effective speed, so
 * every downstream shortest-path / optimization call is automatically
 * traffic-aware and reacts immediately to a simulated or TomTom-sourced
 * incident.
 */

export type TrafficLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';

const SPEED_FACTOR: Record<TrafficLevel, number> = {
  LOW: 0.95, MODERATE: 0.75, HIGH: 0.50, SEVERE: 0.30,
};

export interface GraphNode {
  id: string;
  lat: number;
  lon: number;
  name?: string;
}

export interface GraphEdge {
  id: string;
  u: string;
  v: string;
  name: string;
  distanceKm: number;
  baseSpeedKmph: number;
  roadType: 'highway' | 'arterial' | 'local';
  trafficLevel: TrafficLevel;
  congestionPct: number;
  closed: boolean;
  riskScore: number; // 0-1, static road-risk proxy (higher on narrow/local roads)
  /** continuous slowdown/speed-up applied on top of trafficLevel (incidents, +x% traffic). 1 = neutral. */
  speedMultiplier?: number;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class RoadGraph {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();
  adjacency = new Map<string, string[]>();
  /** network-wide speed factor (weather). 1 = neutral. */
  globalSpeedFactor = 1;

  addNode(n: GraphNode) {
    this.nodes.set(n.id, n);
    if (!this.adjacency.has(n.id)) this.adjacency.set(n.id, []);
  }

  addEdge(e: GraphEdge, bidirectional = true) {
    this.edges.set(e.id, e);
    this.adjacency.get(e.u)?.push(e.id) ?? this.adjacency.set(e.u, [e.id]);
    if (bidirectional) {
      const rev: GraphEdge = { ...e, id: e.id + '_r', u: e.v, v: e.u };
      this.edges.set(rev.id, rev);
      this.adjacency.get(e.v)?.push(rev.id) ?? this.adjacency.set(e.v, [rev.id]);
    }
  }

  neighbors(nodeId: string): GraphEdge[] {
    return (this.adjacency.get(nodeId) || []).map((id) => this.edges.get(id)!).filter(Boolean);
  }

  currentSpeedKmph(e: GraphEdge): number {
    if (e.closed) return 0;
    return Math.max(e.baseSpeedKmph * SPEED_FACTOR[e.trafficLevel] * (e.speedMultiplier ?? 1) * this.globalSpeedFactor, 3);
  }

  travelTimeMin(e: GraphEdge): number {
    const speed = this.currentSpeedKmph(e);
    if (speed <= 0) return Infinity;
    return (e.distanceKm / speed) * 60;
  }

  nearestNode(lat: number, lon: number): string {
    let best = '';
    let bestD = Infinity;
    for (const [id, n] of this.nodes) {
      const d = haversineKm(lat, lon, n.lat, n.lon);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /** Deep copy — scenario simulation and the Time Machine work on clones so the live twin is never mutated. */
  clone(): RoadGraph {
    const g = new RoadGraph();
    g.globalSpeedFactor = this.globalSpeedFactor;
    for (const n of this.nodes.values()) g.nodes.set(n.id, { ...n });
    for (const e of this.edges.values()) g.edges.set(e.id, { ...e });
    for (const [k, v] of this.adjacency) g.adjacency.set(k, [...v]);
    return g;
  }

  /** Fastest speed any open edge can currently reach (km/h). Used for an ADMISSIBLE A* heuristic. */
  maxSpeedKmph(): number {
    let m = 1;
    for (const e of this.edges.values()) { if (!e.closed) m = Math.max(m, this.currentSpeedKmph(e)); }
    return m;
  }

  private reconstruct(source: string, target: string, cost: number, prevNode: Map<string, string>, prevEdge: Map<string, string>) {
    const nodePath: string[] = [target];
    const edgePath: string[] = [];
    let cur = target;
    while (cur !== source) {
      edgePath.push(prevEdge.get(cur)!);
      cur = prevNode.get(cur)!;
      nodePath.push(cur);
    }
    nodePath.reverse();
    edgePath.reverse();
    return { cost, nodePath, edgePath };
  }

  /** Dijkstra shortest path (binary-heap). weight: 'time' | 'distance' */
  dijkstra(source: string, target: string, weight: 'time' | 'distance' = 'time') {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return { cost: Infinity, nodePath: [] as string[], edgePath: [] as string[] };
    if (source === target) return { cost: 0, nodePath: [source], edgePath: [] as string[] };
    const dist = new Map<string, number>([[source, 0]]);
    const prevNode = new Map<string, string>();
    const prevEdge = new Map<string, string>();
    const visited = new Set<string>();
    const heap = new MinHeap<string>();
    heap.push(0, source);
    while (heap.size) {
      const [d, u] = heap.pop()!;
      if (visited.has(u)) continue;
      visited.add(u);
      if (u === target) break;
      for (const e of this.neighbors(u)) {
        if (e.closed) continue;
        const w = weight === 'time' ? this.travelTimeMin(e) : e.distanceKm;
        if (!isFinite(w)) continue;
        const nd = d + w;
        if (nd < (dist.get(e.v) ?? Infinity)) {
          dist.set(e.v, nd); prevNode.set(e.v, u); prevEdge.set(e.v, e.id);
          heap.push(nd, e.v);
        }
      }
    }
    if (!dist.has(target)) return { cost: Infinity, nodePath: [] as string[], edgePath: [] as string[] };
    return this.reconstruct(source, target, dist.get(target)!, prevNode, prevEdge);
  }

  /**
   * A* shortest path. The heuristic is straight-line distance divided by the
   * FASTEST speed currently available anywhere in the graph, which never
   * over-estimates the remaining travel time (admissible + consistent), so A*
   * returns the same optimal cost as Dijkstra. (The previous 60 km/h constant
   * was inadmissible on 76 km/h highways.)
   */
  astar(source: string, target: string, weight: 'time' | 'distance' = 'time') {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return { cost: Infinity, nodePath: [] as string[], edgePath: [] as string[] };
    if (source === target) return { cost: 0, nodePath: [source], edgePath: [] as string[] };
    const vmax = this.maxSpeedKmph();
    const tgt = this.nodes.get(target)!;
    const h = (n: string) => {
      const a = this.nodes.get(n)!;
      const distKm = haversineKm(a.lat, a.lon, tgt.lat, tgt.lon);
      return weight === 'distance' ? distKm : (distKm / vmax) * 60;
    };
    const g = new Map<string, number>([[source, 0]]);
    const prevNode = new Map<string, string>();
    const prevEdge = new Map<string, string>();
    const visited = new Set<string>();
    const heap = new MinHeap<string>();
    heap.push(h(source), source);
    while (heap.size) {
      const [, u] = heap.pop()!;
      if (visited.has(u)) continue;
      visited.add(u);
      if (u === target) break;
      for (const e of this.neighbors(u)) {
        if (e.closed) continue;
        const w = weight === 'time' ? this.travelTimeMin(e) : e.distanceKm;
        if (!isFinite(w)) continue;
        const ng = (g.get(u) ?? Infinity) + w;
        if (ng < (g.get(e.v) ?? Infinity)) {
          g.set(e.v, ng); prevNode.set(e.v, u); prevEdge.set(e.v, e.id);
          heap.push(ng + h(e.v), e.v);
        }
      }
    }
    if (!g.has(target)) return { cost: Infinity, nodePath: [] as string[], edgePath: [] as string[] };
    return this.reconstruct(source, target, g.get(target)!, prevNode, prevEdge);
  }

  shortest(source: string, target: string, algo: 'dijkstra' | 'astar' = 'dijkstra', weight: 'time' | 'distance' = 'time') {
    return algo === 'astar' ? this.astar(source, target, weight) : this.dijkstra(source, target, weight);
  }
}


/** Minimal binary min-heap keyed by priority. */
export class MinHeap<T> {
  private a: [number, T][] = [];
  get size() { return this.a.length; }
  push(p: number, v: T) {
    const a = this.a; a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]]; i = parent;
    }
  }
  pop(): [number, T] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
