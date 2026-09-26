import { env } from '../config/env';
import { NormalizedRoute } from './tomtom';

const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function osrmRoute(points: { lat: number; lon: number }[]): Promise<NormalizedRoute | null> {
  if (points.length < 2) return null;
  const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `${env.OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const data = await fetchWithTimeout(url);
  const route = data?.routes?.[0];
  if (!route) return null;
  const geometry = (route.geometry?.coordinates || []).map((c: number[]) => ({ lat: c[1], lon: c[0] }));
  const instructions = (route.legs || []).flatMap((leg: any) =>
    (leg.steps || []).map((s: any) => s.name ? `Continue on ${s.name}` : 'Continue').filter(Boolean));
  return {
    provider: 'tomtom', // normalized shape reused; the caller overwrites `provider` with 'osrm'
    distanceKm: (route.distance || 0) / 1000,
    durationMinutes: (route.duration || 0) / 60,
    trafficDelayMinutes: 0, // OSRM's public instance has no live traffic
    geometry,
    instructions,
  };
}

export async function checkOsrmHealth(): Promise<'healthy' | 'unreachable'> {
  const data = await fetchWithTimeout(`${env.OSRM_BASE_URL}/route/v1/driving/73.8567,18.5204;73.8570,18.5210?overview=false`);
  return data ? 'healthy' : 'unreachable';
}

export interface OsrmMatchResult {
  lat: number;
  lon: number;
  name: string;
  confidence: number;
}

export async function osrmMatch(points: {lat: number; lon: number}[]): Promise<OsrmMatchResult[] | null> {
  if (points.length < 2) return null; // OSRM match requires at least 2 points
  const coords = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `${env.OSRM_BASE_URL}/match/v1/driving/${coords}?overview=false&radiuses=${points.map(() => '50').join(';')}`;
  const data = await fetchWithTimeout(url);
  if (!data || data.code !== 'Ok' || !data.tracepoints) return null;
  
  return data.tracepoints.map((tp: any, i: number) => {
    if (!tp) return { lat: points[i].lat, lon: points[i].lon, name: 'Unknown', confidence: 0 };
    return {
      lat: tp.location[1],
      lon: tp.location[0],
      name: tp.name || 'Local road',
      confidence: tp.matchings_index !== undefined ? 95 : 50
    };
  });
}

