import { RoadGraph } from './graph';

export function shortestPathAStar(graph: RoadGraph, source: string, target: string, weight: 'time' | 'distance' = 'time') {
  const r = graph.astar(source, target, weight);
  return { ...r, algorithm: 'astar' };
}
