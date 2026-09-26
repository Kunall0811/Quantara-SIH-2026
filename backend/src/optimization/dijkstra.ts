import { RoadGraph } from './graph';

export function shortestPathDijkstra(graph: RoadGraph, source: string, target: string, weight: 'time' | 'distance' = 'time') {
  const r = graph.dijkstra(source, target, weight);
  return { ...r, algorithm: 'dijkstra' };
}
