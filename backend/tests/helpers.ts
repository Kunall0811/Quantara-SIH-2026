import { RoadGraph, GraphNode, GraphEdge } from '../src/optimization/graph';
import { buildIndiaGraph } from '../src/data/indiaGraph';
import { generateDataset } from '../src/optimization/datasetGenerator';
import { DEFAULT_WEIGHTS, WeatherContext } from '../src/optimization/fitness';
import { RunParams } from '../src/optimization/qpso/types';

export const CLEAR: WeatherContext = { rainMm: 0, weatherSeverity: 0 };

export function edge(id: string, u: string, v: string, dist: number, speed = 50, over: Partial<GraphEdge> = {}): GraphEdge {
  return { id, u, v, name: `Road ${id}`, distanceKm: dist, baseSpeedKmph: speed, roadType: 'arterial', trafficLevel: 'LOW', congestionPct: 0.1, closed: false, riskScore: 0.1, ...over };
}

export function squareGraph(): RoadGraph {
  const g = new RoadGraph();
  const nodes: GraphNode[] = [
    { id: 'A', lat: 18.50, lon: 73.85 }, { id: 'B', lat: 18.51, lon: 73.85 },
    { id: 'C', lat: 18.51, lon: 73.86 }, { id: 'D', lat: 18.50, lon: 73.86 },
  ];
  nodes.forEach((n) => g.addNode(n));
  g.addEdge(edge('AB', 'A', 'B', 5)); g.addEdge(edge('BC', 'B', 'C', 5));
  g.addEdge(edge('AD', 'A', 'D', 5)); g.addEdge(edge('DC', 'D', 'C', 5)); g.addEdge(edge('AC', 'A', 'C', 3));
  return g;
}

/** Deterministic VRP instance on the real India/Pune graph. */
export function puneVrp(customers = 6, vehicles = 3, seed = 7, over: Partial<RunParams> = {}): RunParams {
  const graph = buildIndiaGraph();
  const depotId = 'pune-hub';
  const { customers: cs, fleet } = generateDataset(seed, customers, vehicles, graph, depotId);
  // keep customers in the Pune sub-network for realistic, reachable instances
  const puneNodes = [...graph.nodes.keys()].filter((k) => k.startsWith('pune-') && k !== depotId).sort();
  cs.forEach((c, i) => { c.nodeId = puneNodes[(i * 3 + seed) % puneNodes.length]; });
  return { graph, depotId, customers: cs, fleet, weights: DEFAULT_WEIGHTS, weather: CLEAR, populationSize: 16, maxIterations: 25, seed: 42, ...over };
}
