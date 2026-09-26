/** Central routing provider manager.
 * TomTom (live traffic) -> OSRM -> internal road graph.
 * Multi-stop routing is composed from real road geometries; it never draws
 * a straight line between selected places unless every routing tier fails.
 */
import { tomtomRoute, tomtomGeocode } from '../providers/tomtom';
import { osrmRoute } from '../providers/osrm';
import { nominatimGeocode } from '../providers/freeProviders';
import { getGraph } from './graphService';
import { shortestPathDijkstra } from '../optimization/dijkstra';
import { haversineKm } from '../optimization/graph';
import { TtlCache } from '../utils/cache';
import { getStore } from '../store';

const routeCache = new TtlCache<any>(20_000);
const geocodeCache = new TtlCache<any>(6 * 60 * 60_000);
function roundCoord(n: number) { return Math.round(n * 1000) / 1000; }
function round1(n: number) { return Math.round(n * 10) / 10; }

export interface RouteResponse {
  success: true;
  provider: 'tomtom' | 'osrm' | 'internal' | 'mixed';
  fallbackUsed: boolean;
  distanceKm: number;
  durationMinutes: number;
  trafficDelayMinutes: number;
  geometry: { lat: number; lon: number }[];
  instructions: string[];
  trafficLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  legs?: Array<{ from: {lat:number;lon:number}; to:{lat:number;lon:number}; distanceKm:number; durationMinutes:number; provider:string }>;
}

function trafficLevelFromDelay(durationMin: number, delayMin: number): RouteResponse['trafficLevel'] {
  const ratio = durationMin > 0 ? delayMin / durationMin : 0;
  if (ratio > 0.5) return 'SEVERE';
  if (ratio > 0.25) return 'HIGH';
  if (ratio > 0.1) return 'MODERATE';
  return 'LOW';
}

async function hasNearbyAdminIncident(a:{lat:number;lon:number}, b:{lat:number;lon:number}) {
  try {
    const incidents = await getStore().listActiveIncidents();
    const minLat=Math.min(a.lat,b.lat)-0.08,maxLat=Math.max(a.lat,b.lat)+0.08,minLon=Math.min(a.lon,b.lon)-0.08,maxLon=Math.max(a.lon,b.lon)+0.08;
    return incidents.some(i=>i.provider==='admin-console'||i.provider==='friday-admin') && incidents.some(i=>i.lat>=minLat&&i.lat<=maxLat&&i.lon>=minLon&&i.lon<=maxLon);
  } catch { return false; }
}

export async function calculateRoute(origin: { lat:number;lon:number }, destination: {lat:number;lon:number}): Promise<RouteResponse> {
  const key = `route:${roundCoord(origin.lat)},${roundCoord(origin.lon)}->${roundCoord(destination.lat)},${roundCoord(destination.lon)}`;
  return routeCache.getOrCompute(key, async () => {
    const localIncident = await hasNearbyAdminIncident(origin, destination);
    // Admin incidents are part of QUANTARA's live graph, so prefer that graph
    // while one is near the trip. This makes an admin accident/closure capable
    // of changing the route immediately; otherwise TomTom remains primary.
    if (localIncident) {
      const g = getGraph(); const src=g.nearestNode(origin.lat,origin.lon), dst=g.nearestNode(destination.lat,destination.lon);
      const r=shortestPathDijkstra(g,src,dst,'time');
      if(r.cost!==Infinity && r.nodePath.length>=2){
        const distanceKm=r.edgePath.reduce((sum,eid)=>sum+(g.edges.get(eid)?.distanceKm||0),0);
        let geometry=r.nodePath.map(id=>{const n=g.nodes.get(id)!;return{lat:n.lat,lon:n.lon};});
        const instructions=r.edgePath.map(eid=>`Continue on ${g.edges.get(eid)?.name||'road'}`);
        const avg=r.edgePath.length?r.edgePath.reduce((sum,eid)=>sum+(g.edges.get(eid)?.congestionPct||0),0)/r.edgePath.length:0;
        
        // Use OSRM to get real road geometry along the chosen internal path
        try {
           const maxPoints = Math.min(geometry.length, 50); // OSRM limits waypoints
           const sampled: { lat: number; lon: number }[] = [];
           for (let i=0; i<geometry.length; i++) {
             if (i===0 || i===geometry.length-1 || i % Math.ceil(geometry.length/maxPoints) === 0) sampled.push(geometry[i]);
           }
           const osrm = await osrmRoute(sampled);
           if (osrm && osrm.geometry.length >= 2) geometry = osrm.geometry;
        } catch {}
        
        return {success:true,provider:'internal',fallbackUsed:true,distanceKm:round1(distanceKm),durationMinutes:round1(r.cost),trafficDelayMinutes:0,geometry,instructions,trafficLevel:avg>.7?'SEVERE':avg>.45?'HIGH':avg>.2?'MODERATE':'LOW'};
      }
    }
    const tt = await tomtomRoute(origin, destination);
    if (tt && tt.geometry.length >= 2) {
      return { success:true, provider:'tomtom', fallbackUsed:false, distanceKm:round1(tt.distanceKm), durationMinutes:round1(tt.durationMinutes), trafficDelayMinutes:round1(tt.trafficDelayMinutes), geometry:tt.geometry, instructions:tt.instructions, trafficLevel:trafficLevelFromDelay(tt.durationMinutes,tt.trafficDelayMinutes) };
    }
    const osrm = await osrmRoute([origin, destination]);
    if (osrm && osrm.geometry.length >= 2) {
      return { success:true, provider:'osrm', fallbackUsed:true, distanceKm:round1(osrm.distanceKm), durationMinutes:round1(osrm.durationMinutes), trafficDelayMinutes:0, geometry:osrm.geometry, instructions:osrm.instructions, trafficLevel:'LOW' };
    }
    const g = getGraph();
    const src = g.nearestNode(origin.lat, origin.lon), dst = g.nearestNode(destination.lat, destination.lon);
    const result = shortestPathDijkstra(g, src, dst, 'time');
    if (result.cost !== Infinity && result.nodePath.length >= 2) {
      const distanceKm = result.edgePath.reduce((s,eid)=>s+(g.edges.get(eid)?.distanceKm||0),0);
      let geometry = result.nodePath.map(id => { const n=g.nodes.get(id)!; return {lat:n.lat,lon:n.lon}; });
      const instructions = result.edgePath.map(eid => `Continue on ${g.edges.get(eid)?.name || 'road'}`);
      const avg = result.edgePath.length ? result.edgePath.reduce((s,eid)=>s+(g.edges.get(eid)?.congestionPct||0),0)/result.edgePath.length : 0;
      
      try {
         const maxPoints = Math.min(geometry.length, 50);
         const sampled: { lat: number; lon: number }[] = [];
         for (let i=0; i<geometry.length; i++) {
           if (i===0 || i===geometry.length-1 || i % Math.ceil(geometry.length/maxPoints) === 0) sampled.push(geometry[i]);
         }
         const osrmFallback = await osrmRoute(sampled);
         if (osrmFallback && osrmFallback.geometry.length >= 2) geometry = osrmFallback.geometry;
      } catch {}
      
      return { success:true, provider:'internal', fallbackUsed:true, distanceKm:round1(distanceKm), durationMinutes:round1(result.cost), trafficDelayMinutes:0, geometry, instructions, trafficLevel:avg>.7?'SEVERE':avg>.45?'HIGH':avg>.2?'MODERATE':'LOW' };
    }
    const d = haversineKm(origin.lat,origin.lon,destination.lat,destination.lon);
    return { success:true, provider:'internal', fallbackUsed:true, distanceKm:round1(d), durationMinutes:round1(d/35*60), trafficDelayMinutes:0, geometry:[origin,destination], instructions:['No road path was available; straight-line estimate only'], trafficLevel:'LOW' };
  });
}

export async function calculateRouteThrough(points: Array<{lat:number;lon:number;label?:string}>): Promise<RouteResponse> {
  if (points.length < 2) throw new Error('At least two route points are required');
  const legs: RouteResponse['legs'] = [];
  const geometry: {lat:number;lon:number}[] = [];
  let distanceKm=0, durationMinutes=0, trafficDelayMinutes=0;
  let usedFallback=false;
  let provider: RouteResponse['provider'] = 'tomtom';
  let worst: RouteResponse['trafficLevel']='LOW';
  const rank: Record<string,number>={LOW:0,MODERATE:1,HIGH:2,SEVERE:3};
  const instructions:string[]=[];
  for(let i=0;i<points.length-1;i++){
    const leg=await calculateRoute(points[i],points[i+1]);
    legs.push({from:points[i],to:points[i+1],distanceKm:leg.distanceKm,durationMinutes:leg.durationMinutes,provider:leg.provider});
    if(i===0) geometry.push(...leg.geometry); else geometry.push(...leg.geometry.slice(1));
    distanceKm+=leg.distanceKm; durationMinutes+=leg.durationMinutes; trafficDelayMinutes+=leg.trafficDelayMinutes;
    instructions.push(...leg.instructions);
    usedFallback ||= leg.fallbackUsed;
    if(rank[leg.trafficLevel]>rank[worst]) worst=leg.trafficLevel;
    if(provider!==leg.provider) provider='mixed';
    else provider=leg.provider as any;
  }
  return {success:true,provider,fallbackUsed:usedFallback,distanceKm:round1(distanceKm),durationMinutes:round1(durationMinutes),trafficDelayMinutes:round1(trafficDelayMinutes),geometry,instructions,trafficLevel:worst,legs};
}

export interface GeocodeResponse { success:true; provider:'tomtom'|'nominatim'; fallbackUsed:boolean; lat:number; lon:number; displayName:string; }
export async function geocodeAddress(address:string):Promise<GeocodeResponse|{success:false;message:string}> {
  const key=`geocode:${address.toLowerCase().trim()}`;
  return geocodeCache.getOrCompute(key,async()=>{
    const tt=await tomtomGeocode(address); if(tt) return {success:true,provider:'tomtom',fallbackUsed:false,lat:tt.lat,lon:tt.lon,displayName:tt.displayName};
    const nom=await nominatimGeocode(address); if(nom) return {success:true,provider:'nominatim',fallbackUsed:true,lat:nom.lat,lon:nom.lon,displayName:nom.displayName};
    return {success:false,message:'Could not geocode that address.'};
  });
}
