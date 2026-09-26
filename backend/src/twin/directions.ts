/**
 * Turn-by-turn directions derived from the ACTUAL path the optimizer evaluated
 * (nodePath/edgePath on the traffic-aware graph): bearing change between
 * consecutive edges → maneuver, edge names → instruction text, edge distance /
 * current speed → per-step time. Nothing here is templated from a canned route.
 */
import { RoadGraph } from '../optimization/graph';
import { RouteStep } from './types';

export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(b.lon - a.lon)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** signed smallest angle from bearing a to bearing b, in (-180, 180]; positive = clockwise = right turn */
export function turnAngle(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

export function maneuverOf(angle: number): RouteStep['maneuver'] {
  const a = Math.abs(angle);
  if (a < 20) return 'straight';
  if (a >= 160) return 'uturn';
  const side = angle > 0 ? 'right' : 'left';
  if (a < 55) return `slight-${side}` as RouteStep['maneuver'];
  if (a < 125) return side;
  return `sharp-${side}` as RouteStep['maneuver'];
}

const VERB: Record<RouteStep['maneuver'], string> = {
  depart: 'Head out', straight: 'Continue straight', 'slight-left': 'Bear left', left: 'Turn left', 'sharp-left': 'Make a sharp left',
  'slight-right': 'Bear right', right: 'Turn right', 'sharp-right': 'Make a sharp right', uturn: 'Make a U-turn',
  arrive: 'Arrive', stop: 'Delivery stop', roundabout: 'Take the roundabout', merge: 'Merge', fork: 'Keep',
};

const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1)} km`);

/**
 * @param stopNodeIds  customer nodes on this route (in order) so "stop" steps can be inserted
 * @param stopLabels   label per stop (same order)
 */
export function buildSteps(graph: RoadGraph, nodePath: string[], edgePath: string[], stopNodeIds: string[] = [], stopLabels: string[] = []): RouteStep[] {
  if (nodePath.length === 0) return [];
  const loc = (id: string) => { const n = graph.nodes.get(id)!; return { lat: n.lat, lon: n.lon }; };
  const raw: { name: string; angle: number; km: number; min: number; at: string; endNode: string }[] = [];
  let prevBearing: number | null = null;
  for (let i = 0; i < edgePath.length; i++) {
    const e = graph.edges.get(edgePath[i]); if (!e) continue;
    const b = bearingDeg(loc(e.u), loc(e.v));
    const angle = prevBearing === null ? 0 : turnAngle(prevBearing, b);
    prevBearing = b;
    const t = graph.travelTimeMin(e);
    raw.push({ name: e.name, angle, km: e.distanceKm, min: Number.isFinite(t) ? t : 0, at: e.u, endNode: e.v });
  }
  // merge consecutive straight-ahead edges on the same road
  const stopSet = new Set(stopNodeIds);
  const merged: typeof raw = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.name === r.name && Math.abs(r.angle) < 20 && !stopSet.has(last.endNode)) { last.km += r.km; last.min += r.min; last.endNode = r.endNode; }
    else merged.push({ ...r });
  }
  const steps: RouteStep[] = [];
  const stopQueue = stopNodeIds.slice(); const labelQueue = stopLabels.slice();
  merged.forEach((m, k) => {
    const man: RouteStep['maneuver'] = k === 0 ? 'depart' : maneuverOf(m.angle);
    const onto = man === 'depart' ? `Head out on ${m.name}` : man === 'straight' ? `Continue on ${m.name}` : `${VERB[man]} onto ${m.name}`;
    steps.push({ index: steps.length + 1, instruction: `${onto} for ${fmtKm(m.km)}`, maneuver: man, roadName: m.name,
      distanceKm: Number(m.km.toFixed(3)), durationMin: Number(m.min.toFixed(2)), location: loc(m.at) });
    // stop markers at the end of this merged step
    while (stopQueue.length && stopQueue[0] === m.endNode && k < merged.length) {
      const nodeId = stopQueue.shift()!; const label = labelQueue.shift() || nodeId;
      const isLast = !stopQueue.length && k === merged.length - 1 && graph.nodes.get(nodeId) && nodePath[nodePath.length - 1] === nodeId;
      if (!isLast) steps.push({ index: steps.length + 1, instruction: `Delivery stop: ${label}`, maneuver: 'stop', roadName: m.name, distanceKm: 0, durationMin: 0, location: loc(nodeId) });
    }
  });
  const end = nodePath[nodePath.length - 1];
  steps.push({ index: steps.length + 1, instruction: 'Arrive at destination / depot', maneuver: 'arrive', roadName: merged.length ? merged[merged.length - 1].name : '', distanceKm: 0, durationMin: 0, location: loc(end) });
  return steps;
}

/** node-path geometry on the internal graph (used as FALLBACK geometry, labelled as such) */
export function graphGeometry(graph: RoadGraph, nodePath: string[]) {
  return nodePath.map((id) => { const n = graph.nodes.get(id)!; return { lat: n.lat, lon: n.lon }; });
}
