/**
 * TomTom client. All calls are backend-only (the API key never reaches the
 * frontend). Every function returns `null` on any failure - missing key,
 * timeout, quota exceeded, bad response - so callers can fall through to
 * the next provider in the chain rather than crashing.
 */
import { env } from '../config/env';

const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[tomtom] HTTP ${res.status} for ${url.split('?')[0]}`);
      console.warn(`[tomtom] Response body: ${body}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[tomtom] request failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function tomtomConfigured(): boolean {
  return !!env.TOMTOM_API_KEY;
}

export interface NormalizedRoute {
  provider: 'tomtom';
  distanceKm: number;
  durationMinutes: number;
  trafficDelayMinutes: number;
  geometry: { lat: number; lon: number }[];
  instructions: string[];
}

export async function tomtomRoute(origin: { lat: number; lon: number }, destination: { lat: number; lon: number }): Promise<NormalizedRoute | null> {
  if (!tomtomConfigured()) return null;
  const url = `${env.TOMTOM_BASE_URL}/routing/1/calculateRoute/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json` +
    `?key=${env.TOMTOM_API_KEY}&traffic=true&instructionsType=text`;
  const data = await fetchWithTimeout(url);
  if (!data?.routes?.[0]) return null;
  const route = data.routes[0];
  const summary = route.summary;
  const geometry = (route.legs || []).flatMap((leg: any) => (leg.points || []).map((pt: any) => ({ lat: pt.latitude, lon: pt.longitude })));
  const instructions = (route.guidance?.instructions || []).map((i: any) => i.message).filter(Boolean);
  return {
    provider: 'tomtom',
    distanceKm: (summary.lengthInMeters || 0) / 1000,
    durationMinutes: (summary.travelTimeInSeconds || 0) / 60,
    trafficDelayMinutes: (summary.trafficDelayInSeconds || 0) / 60,
    geometry,
    instructions,
  };
}

export interface NormalizedTrafficFlow {
  provider: 'tomtom';
  currentSpeedKmph: number;
  freeFlowSpeedKmph: number;
  congestionPct: number;
}

export async function tomtomTrafficFlow(lat: number, lon: number): Promise<NormalizedTrafficFlow | null> {
  if (!tomtomConfigured()) return null;
  const url = `${env.TOMTOM_BASE_URL}/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&key=${env.TOMTOM_API_KEY}`;
  const data = await fetchWithTimeout(url);
  const seg = data?.flowSegmentData;
  if (!seg) return null;
  const current = seg.currentSpeed || 0;
  const freeFlow = seg.freeFlowSpeed || 1;
  return { provider: 'tomtom', currentSpeedKmph: current, freeFlowSpeedKmph: freeFlow, congestionPct: Math.max(0, 1 - current / freeFlow) };
}

export interface NormalizedIncident {
  id: string;
  type: string;
  lat: number;
  lon: number;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  description: string;
}

export async function tomtomIncidents(bbox: { south: number; west: number; north: number; east: number }): Promise<NormalizedIncident[] | null> {
  if (!tomtomConfigured()) return null;
  const url = `${env.TOMTOM_BASE_URL}/traffic/services/5/incidentDetails?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}` +
    `&fields={incidents{type,geometry{coordinates},properties{iconCategory,magnitudeOfDelay,events{description}}}}&key=${env.TOMTOM_API_KEY}`;
  const data = await fetchWithTimeout(url);
  if (!data?.incidents) return null;
  const severityMap: Record<number, NormalizedIncident['severity']> = { 0: 'LOW', 1: 'LOW', 2: 'MODERATE', 3: 'HIGH', 4: 'SEVERE' };
  return data.incidents.map((inc: any, i: number) => ({
    id: `tomtom-${i}`,
    type: inc.properties?.events?.[0]?.description || 'Incident',
    lat: inc.geometry?.coordinates?.[0]?.[1] ?? 0,
    lon: inc.geometry?.coordinates?.[0]?.[0] ?? 0,
    severity: severityMap[inc.properties?.magnitudeOfDelay ?? 1] || 'MODERATE',
    description: inc.properties?.events?.[0]?.description || '',
  }));
}

export interface NormalizedGeocode {
  provider: 'tomtom';
  lat: number;
  lon: number;
  displayName: string;
}

export async function tomtomGeocode(address: string): Promise<NormalizedGeocode | null> {
  if (!tomtomConfigured()) return null;
  const url = `${env.TOMTOM_BASE_URL}/search/2/geocode/${encodeURIComponent(address)}.json?key=${env.TOMTOM_API_KEY}&countrySet=IN&limit=1`;
  const data = await fetchWithTimeout(url);
  const first = data?.results?.[0];
  if (!first) return null;
  return { provider: 'tomtom', lat: first.position.lat, lon: first.position.lon, displayName: first.address?.freeformAddress || address };
}

export async function checkTomtomHealth(): Promise<'healthy' | 'not_configured' | 'unreachable'> {
  if (!tomtomConfigured()) return 'not_configured';
  const url = `${env.TOMTOM_BASE_URL}/search/2/geocode/Pune.json?key=${env.TOMTOM_API_KEY}&limit=1`;
  const data = await fetchWithTimeout(url);
  return data ? 'healthy' : 'unreachable';
}
