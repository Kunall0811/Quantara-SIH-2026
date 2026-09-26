import { env } from '../config/env';
import { tomtomTrafficFlow, tomtomIncidents } from '../providers/tomtom';
import { liveTrafficSummary, applyRandomFluctuation } from './graphService';
import { getStore } from '../store';
import { TtlCache } from '../utils/cache';

const flowCache = new TtlCache<any>(30_000);

export async function getTrafficAt(lat: number, lon: number) {
  const key = `flow:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return flowCache.getOrCompute(key, async () => {
    if (env.TRAFFIC_PROVIDER === 'tomtom') {
      const flow = await tomtomTrafficFlow(lat, lon);
      if (flow) {
        return { source: 'LIVE', provider: 'tomtom', currentSpeedKmph: flow.currentSpeedKmph,
          freeFlowSpeedKmph: flow.freeFlowSpeedKmph, congestionPct: Math.round(flow.congestionPct * 1000) / 10 };
      }
    }
    // fallback: simulation, driven by the same graph the optimizer reads from
    return { source: 'SIMULATED', provider: 'internal-simulation', ...liveTrafficSummary() };
  });
}

export async function getNetworkTrafficSummary() {
  if (env.TRAFFIC_PROVIDER === 'tomtom') {
    // Use a small cached sample of real flow points rather than making a
    // large number of quota-consuming calls. This turns the command center
    // summary into a live signal when a TomTom key is present.
    const points = [
      [18.5204, 73.8567], [18.5590, 73.7869], [18.5912, 73.7389], [18.5089, 73.9260],
    ] as const;
    const flows = await Promise.all(points.map(([lat, lon]) => tomtomTrafficFlow(lat, lon)));
    const live = flows.filter(Boolean) as any[];
    if (live.length) {
      const avg = live.reduce((a, f) => a + (f.congestionPct || 0), 0) / live.length;
      const avgSpeed = live.reduce((a, f) => a + (f.currentSpeedKmph || 0), 0) / live.length;
      const free = live.reduce((a, f) => a + (f.freeFlowSpeedKmph || 0), 0) / live.length;
      return { source: 'LIVE' as const, provider: 'tomtom', avgCongestionPct: Math.round(avg * 1000) / 10, currentSpeedKmph: Math.round(avgSpeed * 10) / 10, freeFlowSpeedKmph: Math.round(free * 10) / 10, samples: live.length };
    }
  }
  const summary = liveTrafficSummary();
  return { source: 'SIMULATED' as const, provider: 'internal-simulation', ...summary };
}

export async function getIncidents(bbox: { south: number; west: number; north: number; east: number }) {
  const store = getStore();
  const stored = await store.listActiveIncidents();
  const adminIncidents = stored.filter(i => i.lat >= bbox.south && i.lat <= bbox.north && i.lon >= bbox.west && i.lon <= bbox.east)
    .map(i => ({ id:i.id, type:i.type, lat:i.lat, lon:i.lon, severity:i.severity, description:i.description, provider:i.provider, source:'ADMIN' }));
  if (env.TRAFFIC_PROVIDER === 'tomtom') {
    const live = await tomtomIncidents(bbox);
    if (live) {
      const merged = [...live.map(i => ({...i, source:'TOMTOM'})), ...adminIncidents];
      return { source:'LIVE' as const, provider:'tomtom+admin', incidents:merged };
    }
  }
  return { source:'SIMULATED' as const, provider:'internal-simulation+admin', incidents:adminIncidents };
}

export function stepBackgroundDrift() {
  return applyRandomFluctuation(0.08);
}
