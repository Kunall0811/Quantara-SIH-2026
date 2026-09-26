/** Pure network mutations shared by the live twin (applyEvent) and dry-run scenario simulation (on graph clones). */
import { RoadGraph } from '../optimization/graph';
import { EventRequest } from './types';
import { resolveRoad } from './roadCodes';
import { WEATHER_MODEL } from '../services/graphService';

export interface NetworkMutation { edges: string[]; networkWide: boolean; description: string; roadBase?: string; closed?: boolean }

/** Applies ROAD_CLOSURE / ACCIDENT / TRAFFIC_INCREASE. `defaultRoad` is used when the request names no road. */
export function mutateNetwork(g: RoadGraph, req: EventRequest, defaultRoad?: string | null): NetworkMutation {
  const affected: string[] = [];
  if (req.type === 'ROAD_CLOSURE' || req.type === 'ACCIDENT') {
    const ref = req.road ?? defaultRoad;
    if (!ref) throw new Error('No road specified and no active plan to pick a road from.');
    const road = resolveRoad(g, ref);
    if (!road) throw new Error(`Unknown road: "${ref}". Use an edge id, a road code like R-142, or a road name.`);
    for (const id of road.ids) {
      const e = g.edges.get(id)!;
      if (req.type === 'ROAD_CLOSURE') { e.closed = true; e.trafficLevel = 'SEVERE'; e.congestionPct = 1; }
      else { e.speedMultiplier = (e.speedMultiplier ?? 1) * 0.4; e.congestionPct = Math.max(e.congestionPct, 0.85); e.riskScore = Math.min(1, e.riskScore + 0.3); }
      affected.push(id);
      if (req.type === 'ACCIDENT') {                       // queue spills back onto roads feeding this one
        for (const up of g.edges.values()) if (up.v === e.u && !affected.includes(up.id) && !up.closed) { up.speedMultiplier = (up.speedMultiplier ?? 1) * 0.75; up.congestionPct = Math.max(up.congestionPct, 0.6); affected.push(up.id); }
      }
    }
    return {
      edges: affected, networkWide: false, roadBase: road.base, closed: req.type === 'ROAD_CLOSURE',
      description: req.type === 'ROAD_CLOSURE' ? `${road.name} (${road.code}) closed in both directions.` : `Accident on ${road.name} (${road.code}): speed there cut to 40%, upstream roads to 75%, risk +0.3.`,
    };
  }
  if (req.type === 'TRAFFIC_INCREASE') {
    const pct = req.percent ?? 30;
    if (!(pct > 0 && pct <= 500)) throw new Error('percent must be within (0, 500].');
    const scope = req.scope ?? (req.road ? 'ROAD' : 'ALL');
    const f = 1 + pct / 100;
    let targets: string[];
    if (scope === 'ROAD') { const road = resolveRoad(g, req.road ?? ''); if (!road) throw new Error(`Unknown road: "${req.road}".`); targets = road.ids; }
    else targets = [...g.edges.values()].filter((e) => !e.closed && (scope === 'ALL' || e.roadType !== 'local')).map((e) => e.id);
    for (const id of targets) { const e = g.edges.get(id)!; e.speedMultiplier = (e.speedMultiplier ?? 1) / f; e.congestionPct = Math.min(1, e.congestionPct + Math.min(0.4, pct / 250)); }
    return {
      edges: targets, networkWide: scope !== 'ROAD',
      description: scope === 'ROAD' ? `Traffic +${pct}% (travel time) on ${g.edges.get(targets[0])!.name}.` : `Traffic +${pct}% travel time across ${scope === 'ALL' ? 'the whole network' : 'arterial and highway roads'}.`,
    };
  }
  throw new Error(`mutateNetwork does not handle ${req.type}`);
}

/** Weather on a graph clone (the live twin uses graphService.triggerSimulation, which is the same model). */
export function applyWeatherToClone(g: RoadGraph, condition: string) {
  const m = WEATHER_MODEL[condition]; if (!m) throw new Error(`Unknown weather condition: ${condition}`);
  for (const e of g.edges.values()) if (!e.closed) e.congestionPct = Math.min(1, e.congestionPct + m.congestionAdd);
  g.globalSpeedFactor = m.speed;
  return m;
}
