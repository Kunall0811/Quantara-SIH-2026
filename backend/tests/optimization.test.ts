import { RoadGraph, GraphNode, GraphEdge } from '../src/optimization/graph';
import { DEFAULT_WEIGHTS } from '../src/optimization/fitness';
import { runQPSO } from '../src/optimization/qpso';
import { runPSO } from '../src/optimization/pso';
import { shortestPathDijkstra } from '../src/optimization/dijkstra';
import { shortestPathAStar } from '../src/optimization/astar';

function buildSquareGraph(): RoadGraph {
  const g = new RoadGraph();
  const nodes: GraphNode[] = [
    { id: 'A', lat: 18.50, lon: 73.85 },
    { id: 'B', lat: 18.51, lon: 73.85 },
    { id: 'C', lat: 18.51, lon: 73.86 },
    { id: 'D', lat: 18.50, lon: 73.86 },
  ];
  nodes.forEach((n) => g.addNode(n));
  const edge = (id: string, u: string, v: string, dist: number): GraphEdge => ({
    id, u, v, name: `Road ${id}`, distanceKm: dist, baseSpeedKmph: 50,
    roadType: 'arterial', trafficLevel: 'LOW', congestionPct: 0.1, closed: false, riskScore: 0.1,
  });
  g.addEdge(edge('AB', 'A', 'B', 5), true);
  g.addEdge(edge('BC', 'B', 'C', 5), true);
  g.addEdge(edge('AD', 'A', 'D', 5), true);
  g.addEdge(edge('DC', 'D', 'C', 5), true);
  g.addEdge(edge('AC', 'A', 'C', 3), true);
  return g;
}

test('dijkstra finds the shortcut', () => {
  const g = buildSquareGraph();
  const r = shortestPathDijkstra(g, 'A', 'C', 'distance');
  expect(r.cost).toBe(3);
});

test('astar matches dijkstra cost', () => {
  const g = buildSquareGraph();
  const d = shortestPathDijkstra(g, 'A', 'C', 'distance');
  const a = shortestPathAStar(g, 'A', 'C', 'distance');
  expect(a.cost).toBeCloseTo(d.cost, 6);
});

test('closed road forces a detour', () => {
  const g = buildSquareGraph();
  g.edges.get('AC')!.closed = true;
  g.edges.get('AC_r')!.closed = true;
  const r = shortestPathDijkstra(g, 'A', 'C', 'distance');
  expect(r.cost).toBe(10);
});

test('QPSO finds a valid multi-stop order and converges', () => {
  const g = buildSquareGraph();
  const result = runQPSO({
    graph: g, originId: 'A', destinationId: 'C', waypointIds: ['B', 'D'],
    weights: DEFAULT_WEIGHTS,
    vehicle: { fuelEfficiencyKmPerL: 15, fuelType: 'petrol', priority: 'normal' },
    weather: { rainMm: 0, weatherSeverity: 0 },
    populationSize: 12, maxIterations: 20, seed: 1,
  });
  expect(result.convergence.length).toBeGreaterThan(0);
  expect(result.bestOrder[0]).toBe('A');
  expect(result.bestOrder[result.bestOrder.length - 1]).toBe('C');
  expect(result.bestEval.unreachableSegments).toBe(0);
});

function buildLargerGraph(): RoadGraph {
  // A small grid with enough intermediate nodes to give the waypoint-order
  // search a non-trivial permutation space (2 waypoints = only 2 possible
  // orders, which both algorithms trivially solve identically - not a
  // meaningful test of search *trajectory* divergence).
  const g = new RoadGraph();
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const coords: Record<string, [number, number]> = {
    A: [18.50, 73.85], B: [18.51, 73.85], C: [18.52, 73.86], D: [18.50, 73.87],
    E: [18.53, 73.85], F: [18.505, 73.865], G: [18.515, 73.855],
  };
  ids.forEach((id) => g.addNode({ id, lat: coords[id][0], lon: coords[id][1] }));
  const edge = (id: string, u: string, v: string, dist: number): GraphEdge => ({
    id, u, v, name: `Road ${id}`, distanceKm: dist, baseSpeedKmph: 45,
    roadType: 'arterial', trafficLevel: 'LOW', congestionPct: 0.1, closed: false, riskScore: 0.1,
  });
  // fully connect with varied distances so ordering actually matters
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const dist = 2 + ((i * 7 + j * 3) % 11);
      g.addEdge(edge(`e${n++}`, ids[i], ids[j], dist), true);
    }
  }
  return g;
}

test('QPSO and PSO diverge in search trajectory (real, distinct algorithms)', () => {
  const g = buildLargerGraph();
  const base = {
    graph: g, originId: 'A', destinationId: 'E', waypointIds: ['B', 'C', 'D', 'F', 'G'],
    weights: DEFAULT_WEIGHTS,
    vehicle: { fuelEfficiencyKmPerL: 15, fuelType: 'petrol' as const, priority: 'normal' as const },
    weather: { rainMm: 0, weatherSeverity: 0 },
    populationSize: 10, maxIterations: 15, seed: 5,
  };
  const q = runQPSO(base);
  const p = runPSO(base);
  // Both start from the identical swarm (fair comparison) and may both find this tiny
  // instance's optimum immediately, so distinctness is asserted on swarm dynamics.
  expect(q.iterationHistory.map((h) => h.meanFitness)).not.toEqual(p.iterationHistory.map((h) => h.meanFitness));
  expect(q.iterationHistory.map((h) => h.diversity)).not.toEqual(p.iterationHistory.map((h) => h.diversity));
});

test('no waypoints still returns a valid single-segment result', () => {
  const g = buildSquareGraph();
  const result = runQPSO({
    graph: g, originId: 'A', destinationId: 'C', waypointIds: [],
    weights: DEFAULT_WEIGHTS,
    vehicle: { fuelEfficiencyKmPerL: 15, fuelType: 'petrol', priority: 'normal' },
    weather: { rainMm: 0, weatherSeverity: 0 },
  });
  expect(result.bestOrder).toEqual(['A', 'C']);
  expect(result.bestEval.distanceKm).toBe(3);
});

test('A* is admissible: matches Dijkstra on TIME even with a fast (>60 km/h) highway', () => {
  const g = new RoadGraph();
  ['S', 'M', 'T', 'X'].forEach((id, i) => g.addNode({ id, lat: 18.5 + i * 0.05, lon: 73.85 }));
  const mk = (id: string, u: string, v: string, d: number, sp: number, rt: 'highway' | 'local'): GraphEdge => ({ id, u, v, name: id, distanceKm: d, baseSpeedKmph: sp, roadType: rt, trafficLevel: 'LOW', congestionPct: 0.1, closed: false, riskScore: 0.1 });
  g.addEdge(mk('e1', 'S', 'M', 6, 100, 'highway'));   // very fast
  g.addEdge(mk('e2', 'M', 'T', 6, 100, 'highway'));
  g.addEdge(mk('e3', 'S', 'X', 5, 30, 'local'));
  g.addEdge(mk('e4', 'X', 'T', 5, 30, 'local'));
  const d = shortestPathDijkstra(g, 'S', 'T', 'time'), a = shortestPathAStar(g, 'S', 'T', 'time');
  expect(a.cost).toBeCloseTo(d.cost, 9);
  expect(a.nodePath).toEqual(['S', 'M', 'T']);
});

test('two customers on the same graph node are a valid zero-length leg, not "unreachable"', () => {
  const g = buildSquareGraph();
  const r = runQPSO({
    graph: g, depotId: 'A',
    customers: [{ id: 'C1', nodeId: 'C', demand: 1, readyTime: 0, dueTime: 999, serviceTime: 5 }, { id: 'C2', nodeId: 'C', demand: 1, readyTime: 0, dueTime: 999, serviceTime: 5 }],
    fleet: [{ id: 'V1', fuelEfficiencyKmPerL: 15, fuelType: 'electric', priority: 'normal', capacity: 10 }],
    weights: DEFAULT_WEIGHTS, weather: { rainMm: 0, weatherSeverity: 0 }, populationSize: 6, maxIterations: 5, seed: 3,
  });
  expect(r.bestEval.unreachableSegments).toBe(0);
  expect(r.feasible).toBe(true);
});
