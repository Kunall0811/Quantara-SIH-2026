import { env } from '../config/env';

const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface NormalizedWeather {
  provider: 'open-meteo';
  temperature: number | null;
  windSpeed: number | null;
  weatherCode: number | null;
  rainMm: number;
  weatherSeverity: number; // 0..1, derived from weatherCode
  timestamp: string | null;
}

function severityFromCode(code: number | null): number {
  if (code === null) return 0;
  if (code >= 95) return 1.0;   // thunderstorm
  if (code >= 80) return 0.75;  // rain showers
  if (code >= 61) return 0.6;   // rain
  if (code >= 51) return 0.35;  // drizzle
  if (code >= 45) return 0.25;  // fog
  return 0.05;
}

export async function getWeather(lat: number, lon: number): Promise<NormalizedWeather> {
  // Real-time API
  const url = `${env.OPEN_METEO_BASE_URL}/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=precipitation`;
  const data = await fetchWithTimeout(url);
  const cw = data?.current_weather;
  
  // Historical API (5 years ago from today)
  const today = new Date();
  const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate()).toISOString().split('T')[0];
  const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];
  
  const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${fiveYearsAgo}&end_date=${lastYear}&daily=precipitation_sum,temperature_2m_max&timezone=auto`;
  // Do not await strictly, we don't want to block if archive is down
  let historicalRisk = 0;
  try {
    const histData = await fetchWithTimeout(archiveUrl);
    if (histData && histData.daily && histData.daily.precipitation_sum) {
      // Find average precipitation over the historical timeframe
      const sums = histData.daily.precipitation_sum.filter((x: any) => x !== null);
      if (sums.length) {
        const avgPrec = sums.reduce((a:number, b:number) => a + b, 0) / sums.length;
        historicalRisk = Math.min(1.0, avgPrec / 10); // Normalise risk 0-1
      }
    }
  } catch (e) { console.warn('Historical weather fetch failed'); }

  if (!cw) {
    return { provider: 'open-meteo', temperature: null, windSpeed: null, weatherCode: null, rainMm: 0, weatherSeverity: historicalRisk, timestamp: null };
  }
  
  // Combine live severity + historical risk (weighted)
  const liveSeverity = severityFromCode(cw.weathercode ?? null);
  const combinedSeverity = (liveSeverity * 0.7) + (historicalRisk * 0.3);

  return {
    provider: 'open-meteo',
    temperature: cw.temperature ?? null,
    windSpeed: cw.windspeed ?? null,
    weatherCode: cw.weathercode ?? null,
    rainMm: 0,
    weatherSeverity: Math.min(1.0, combinedSeverity),
    timestamp: cw.time ?? null,
  };
}

export async function checkOpenMeteoHealth(): Promise<'healthy' | 'unreachable'> {
  const data = await fetchWithTimeout(`${env.OPEN_METEO_BASE_URL}/v1/forecast?latitude=18.52&longitude=73.85&current_weather=true`);
  return data ? 'healthy' : 'unreachable';
}

export interface NormalizedGeocode {
  provider: 'nominatim';
  lat: number;
  lon: number;
  displayName: string;
}

export async function nominatimGeocode(address: string): Promise<NormalizedGeocode | null> {
  const url = `${env.NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(address)}&format=json&countrycodes=in&limit=1`;
  const data = await fetchWithTimeout(url, { 'User-Agent': 'QRouteIndia/2.0' });
  const first = Array.isArray(data) ? data[0] : null;
  if (!first) return null;
  return { provider: 'nominatim', lat: parseFloat(first.lat), lon: parseFloat(first.lon), displayName: first.display_name };
}

export async function nominatimReverseGeocode(lat: number, lon: number): Promise<NormalizedGeocode | null> {
  const url = `${env.NOMINATIM_BASE_URL}/reverse?lat=${lat}&lon=${lon}&format=json`;
  const data = await fetchWithTimeout(url, { 'User-Agent': 'QRouteIndia/2.0' });
  if (!data) return null;
  return { provider: 'nominatim', lat, lon, displayName: data.display_name || '' };
}

export async function checkNominatimHealth(): Promise<'healthy' | 'unreachable'> {
  const data = await fetchWithTimeout(`${env.NOMINATIM_BASE_URL}/search?q=Pune&format=json&limit=1`, { 'User-Agent': 'QRouteIndia/2.0' });
  return data ? 'healthy' : 'unreachable';
}
