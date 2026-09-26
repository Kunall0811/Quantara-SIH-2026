import { getStore } from '../store';
import {
  pickRandomOpenEdge, closeEdge, reopenEdge, setEdgeTraffic, triggerRushHour, triggerSimulation,
  applyRandomFluctuation, getGraph,
} from './graphService';

export type ScenarioType = 'ACCIDENT' | 'ROAD_CLOSURE' | 'RUSH_HOUR' | 'HEAVY_RAIN' | 'RANDOM_CONGESTION';

export async function triggerScenario(type: ScenarioType, edgeId?: string, cityKey?: string) {
  const store = getStore();
  const g = getGraph();

  switch (type) {
    case 'ACCIDENT': {
      const id = edgeId || pickRandomOpenEdge(cityKey);
      if (!id) return null;
      setEdgeTraffic(id, 'SEVERE', 0.9);
      const e = g.edges.get(id)!;
      const n = g.nodes.get(e.u);
      return store.createIncident({ type: 'ACCIDENT', lat: n?.lat ?? 18.5204, lon: n?.lon ?? 73.8567, severity: 'HIGH',
        description: `Accident reported on ${e.name}`, provider: 'internal-simulation', edgeId: id, closedEdge: false });
    }
    case 'ROAD_CLOSURE': {
      const id = edgeId || pickRandomOpenEdge(cityKey);
      if (!id) return null;
      closeEdge(id);
      const e = g.edges.get(id)!;
      const n = g.nodes.get(e.u);
      return store.createIncident({ type: 'ROAD_CLOSURE', lat: n?.lat ?? 18.5204, lon: n?.lon ?? 73.8567, severity: 'HIGH',
        description: `${e.name} closed to traffic`, provider: 'internal-simulation', edgeId: id, closedEdge: true });
    }
    case 'RUSH_HOUR': {
      triggerRushHour();
      return store.createIncident({ type: 'RUSH_HOUR', lat: 0, lon: 0, severity: 'HIGH',
        description: 'Rush-hour congestion applied across arterial/highway network', provider: 'internal-simulation' });
    }
    case 'HEAVY_RAIN': {
      triggerSimulation('Heavy Rain');
      return store.createIncident({ type: 'HEAVY_RAIN', lat: 0, lon: 0, severity: 'MODERATE',
        description: 'Heavy rain reducing road speeds network-wide', provider: 'internal-simulation' });
    }
    case 'RANDOM_CONGESTION': {
      const changed = applyRandomFluctuation(0.35);
      return { changedEdges: changed.length };
    }
    default:
      return null;
  }
}

export async function resolveIncident(id: string) {
  const store = getStore();
  // Look up the incident first so we know which graph edge (if any) it
  // affected, and restore that road's condition instead of leaving it
  // permanently closed/degraded after the incident is closed.
  const incident = await store.getIncident(id);
  if (incident?.edgeId) {
    if (incident.closedEdge) reopenEdge(incident.edgeId);
    else setEdgeTraffic(incident.edgeId, 'LOW', 0.1);
  }
  await store.resolveIncident(id);
}
