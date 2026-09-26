/**
 * Synthetic-but-realistic India road network used as the LAST-RESORT
 * internal routing fallback (TomTom -> OSRM -> this) and as the traffic
 * simulation substrate. Each supported city gets a small local road grid
 * around real neighbourhood coordinates; cities are cross-linked by
 * approximate highway edges so a fallback route between cities is still
 * possible (clearly a rough approximation, not turn-by-turn accurate -
 * that precision comes from TomTom/OSRM when reachable).
 */
import { RoadGraph, GraphNode, GraphEdge, haversineKm, TrafficLevel } from '../optimization/graph';

export interface CityDef {
  key: string;
  name: string;
  lat: number;
  lon: number;
  areas: { name: string; lat: number; lon: number }[];
}

export const INDIA_CITIES: CityDef[] = [
  { key: 'pune', name: 'Pune', lat: 18.5204, lon: 73.8567, areas: [
    { name: 'Hinjewadi', lat: 18.5912, lon: 73.7389 }, { name: 'Wakad', lat: 18.5978, lon: 73.7645 },
    { name: 'Baner', lat: 18.5590, lon: 73.7869 }, { name: 'Kothrud', lat: 18.5074, lon: 73.8077 },
    { name: 'Swargate', lat: 18.5010, lon: 73.8580 }, { name: 'Hadapsar', lat: 18.5089, lon: 73.9260 },
  ]},
  { key: 'mumbai', name: 'Mumbai', lat: 19.0760, lon: 72.8777, areas: [
    { name: 'Andheri', lat: 19.1197, lon: 72.8468 }, { name: 'Bandra', lat: 19.0596, lon: 72.8295 },
    { name: 'Dadar', lat: 19.0176, lon: 72.8431 }, { name: 'Powai', lat: 19.1176, lon: 72.9060 },
    { name: 'Worli', lat: 19.0176, lon: 72.8161 }, { name: 'Borivali', lat: 19.2307, lon: 72.8567 },
  ]},
  { key: 'delhi', name: 'Delhi NCR', lat: 28.6139, lon: 77.2090, areas: [
    { name: 'Connaught Place', lat: 28.6315, lon: 77.2167 }, { name: 'Dwarka', lat: 28.5921, lon: 77.0460 },
    { name: 'Gurugram', lat: 28.4595, lon: 77.0266 }, { name: 'Noida', lat: 28.5355, lon: 77.3910 },
    { name: 'Saket', lat: 28.5245, lon: 77.2066 }, { name: 'Rohini', lat: 28.7041, lon: 77.1025 },
  ]},
  { key: 'bengaluru', name: 'Bengaluru', lat: 12.9716, lon: 77.5946, areas: [
    { name: 'Whitefield', lat: 12.9698, lon: 77.7500 }, { name: 'Koramangala', lat: 12.9352, lon: 77.6245 },
    { name: 'Indiranagar', lat: 12.9784, lon: 77.6408 }, { name: 'Electronic City', lat: 12.8452, lon: 77.6602 },
    { name: 'Jayanagar', lat: 12.9308, lon: 77.5838 }, { name: 'Hebbal', lat: 13.0358, lon: 77.5970 },
  ]},
  { key: 'hyderabad', name: 'Hyderabad', lat: 17.3850, lon: 78.4867, areas: [
    { name: 'Hitech City', lat: 17.4483, lon: 78.3915 }, { name: 'Gachibowli', lat: 17.4401, lon: 78.3489 },
    { name: 'Secunderabad', lat: 17.4399, lon: 78.4983 }, { name: 'Banjara Hills', lat: 17.4156, lon: 78.4347 },
  ]},
  { key: 'chennai', name: 'Chennai', lat: 13.0827, lon: 80.2707, areas: [
    { name: 'T Nagar', lat: 13.0418, lon: 80.2341 }, { name: 'Velachery', lat: 12.9791, lon: 80.2212 },
    { name: 'Anna Nagar', lat: 13.0850, lon: 80.2101 }, { name: 'OMR', lat: 12.9010, lon: 80.2279 },
  ]},
  { key: 'kolkata', name: 'Kolkata', lat: 22.5726, lon: 88.3639, areas: [
    { name: 'Salt Lake', lat: 22.5800, lon: 88.4180 }, { name: 'Howrah', lat: 22.5958, lon: 88.2636 },
    { name: 'Park Street', lat: 22.5527, lon: 88.3527 },
  ]},
  { key: 'ahmedabad', name: 'Ahmedabad', lat: 23.0225, lon: 72.5714, areas: [
    { name: 'Navrangpura', lat: 23.0365, lon: 72.5610 }, { name: 'Satellite', lat: 23.0270, lon: 72.5150 },
    { name: 'Bopal', lat: 23.0339, lon: 72.4692 },
  ]},
  { key: 'jaipur', name: 'Jaipur', lat: 26.9124, lon: 75.7873, areas: [
    { name: 'Malviya Nagar', lat: 26.8514, lon: 75.8055 }, { name: 'Vaishali Nagar', lat: 26.9123, lon: 75.7377 },
  ]},
  { key: 'nagpur', name: 'Nagpur', lat: 21.1458, lon: 79.0882, areas: [
    { name: 'Dharampeth', lat: 21.1394, lon: 79.0669 }, { name: 'Sadar', lat: 21.1622, lon: 79.0745 },
  ]},
  { key: 'nashik', name: 'Nashik', lat: 19.9975, lon: 73.7898, areas: [
    { name: 'College Road', lat: 20.0059, lon: 73.7784 }, { name: 'Gangapur Road', lat: 19.9975, lon: 73.7500 },
  ]},
];

const ROAD_NAMES = ['NH48', 'NH4', 'Ring Road', 'Outer Ring Road', 'MG Road', 'Airport Road', 'Station Road', 'Link Road'];

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/**
 * Pune "digital twin" corridor network: real neighbourhood coordinates joined by
 * the actual arterial corridors (Baner Rd, University Rd, JM/FC Rd, Karve Rd, Solapur Rd,
 * Nagar Rd, Satara Rd, Sinhagad Rd, Old Mumbai–Pune Hwy...). Edge lengths are haversine × 1.3
 * (road-circuity factor). This is a MODELLED network (SIMULATED traffic), sized so that
 * closures and accidents have genuine alternative paths for re-optimization.
 */
const PUNE_EXTRA_NODES: [string, string, number, number][] = [
  ['shivajinagar', 'Shivajinagar', 18.5308, 73.8474], ['deccan', 'Deccan Gymkhana', 18.5167, 73.8412],
  ['station', 'Pune Station', 18.5286, 73.8742], ['camp', 'Camp (MG Road)', 18.5155, 73.8790],
  ['koregaon', 'Koregaon Park', 18.5362, 73.8940], ['kalyani', 'Kalyani Nagar', 18.5460, 73.9030],
  ['viman', 'Viman Nagar', 18.5679, 73.9143], ['kharadi', 'Kharadi', 18.5511, 73.9400],
  ['magarpatta', 'Magarpatta', 18.5145, 73.9260], ['wanowrie', 'Wanowrie', 18.4950, 73.8950],
  ['kondhwa', 'Kondhwa', 18.4650, 73.8930], ['katraj', 'Katraj', 18.4575, 73.8676],
  ['bibwewadi', 'Bibwewadi', 18.4770, 73.8580], ['sinhagad', 'Sinhagad Road', 18.4820, 73.8130],
  ['karve', 'Karve Nagar', 18.4906, 73.8210], ['warje', 'Warje', 18.4820, 73.8000],
  ['aundh', 'Aundh', 18.5580, 73.8075], ['balewadi', 'Balewadi', 18.5750, 73.7790],
  ['pashan', 'Pashan', 18.5390, 73.7920], ['university', 'University (SPPU)', 18.5490, 73.8290],
  ['yerwada', 'Yerwada', 18.5630, 73.8890], ['pimpri', 'Pimpri', 18.6279, 73.8009],
  ['chinchwad', 'Chinchwad', 18.6448, 73.7897],
];
// [a, b, road name, type, speed km/h]. 'hub' and 'area-N' refer to the base Pune nodes.
const PUNE_CORRIDORS: [string, string, string, 'highway' | 'arterial' | 'local', number][] = [
  ['area-0', 'area-1', 'Hinjewadi Road', 'arterial', 40], ['area-1', 'balewadi', 'Wakad–Balewadi Road', 'arterial', 40],
  ['balewadi', 'area-2', 'Balewadi High Street', 'arterial', 40], ['area-2', 'aundh', 'Baner Road', 'arterial', 40],
  ['area-2', 'pashan', 'Baner–Pashan Link', 'local', 30], ['aundh', 'university', 'Aundh Road', 'arterial', 40],
  ['university', 'shivajinagar', 'University Road', 'arterial', 45], ['pashan', 'university', 'Pashan Road', 'local', 30],
  ['shivajinagar', 'deccan', 'FC / JM Road', 'arterial', 35], ['deccan', 'hub', 'Bajirao Road', 'local', 30],
  ['hub', 'area-4', 'Shankarsheth Road', 'arterial', 35], ['hub', 'station', 'Bund Garden Road', 'arterial', 40],
  ['station', 'camp', 'MG Road', 'arterial', 30], ['station', 'koregaon', 'Koregaon Park Road', 'arterial', 35],
  ['koregaon', 'kalyani', 'North Main Road', 'local', 30], ['kalyani', 'viman', 'Airport Road', 'arterial', 45],
  ['viman', 'kharadi', 'Nagar Road', 'arterial', 45], ['station', 'yerwada', 'Nagar Road (west)', 'arterial', 40],
  ['yerwada', 'kalyani', 'Yerwada Link', 'local', 30], ['yerwada', 'viman', 'Viman Nagar Road', 'local', 30],
  ['camp', 'wanowrie', 'Solapur Road (west)', 'highway', 55], ['wanowrie', 'magarpatta', 'Solapur Road', 'highway', 55],
  ['magarpatta', 'area-5', 'Magarpatta Road', 'arterial', 40], ['kharadi', 'magarpatta', 'Kharadi Bypass', 'arterial', 45],
  ['kharadi', 'area-5', 'Kharadi–Hadapsar Road', 'arterial', 40], ['wanowrie', 'kondhwa', 'Kondhwa Road', 'local', 30],
  ['kondhwa', 'bibwewadi', 'Katraj–Kondhwa Road', 'local', 30], ['area-4', 'bibwewadi', 'Satara Road', 'highway', 55],
  ['bibwewadi', 'katraj', 'Pune–Satara Highway', 'highway', 60], ['area-4', 'sinhagad', 'Sinhagad Road', 'arterial', 40],
  ['sinhagad', 'karve', 'Sinhagad Link', 'local', 30], ['karve', 'area-3', 'Karve Road', 'arterial', 40],
  ['area-3', 'deccan', 'Karve Road (east)', 'arterial', 35], ['karve', 'warje', 'Warje Road', 'local', 30],
  ['area-3', 'pashan', 'Paud Road', 'arterial', 40], ['area-1', 'pimpri', 'Wakad–Pimpri Road', 'arterial', 45],
  ['pimpri', 'chinchwad', 'Old Mumbai–Pune Road', 'arterial', 45], ['pimpri', 'aundh', 'Aundh–Pimpri Spine Road', 'arterial', 45],
  ['chinchwad', 'station', 'Pune–Mumbai Highway (NH48)', 'highway', 60], ['pimpri', 'shivajinagar', 'Old Highway', 'arterial', 45],
  ['magarpatta', 'kondhwa', 'NIBM Road', 'local', 30], ['deccan', 'camp', 'Laxmi Road', 'arterial', 25],
];

function addPuneCorridors(g: RoadGraph) {
  const id = (k: string) => (k === 'hub' ? 'pune-hub' : k.startsWith('area-') ? `pune-${k}` : `pune-n-${k}`);
  for (const [slug, name, lat, lon] of PUNE_EXTRA_NODES) g.addNode({ id: `pune-n-${slug}`, lat, lon, name });
  const r = mulberry32(1337);                      // separate stream so base-graph randomness is unchanged
  for (const [a, b, name, type, speed] of PUNE_CORRIDORS) {
    const na = g.nodes.get(id(a))!, nb = g.nodes.get(id(b))!;
    const km = Math.max(0.6, haversineKm(na.lat, na.lon, nb.lat, nb.lon) * 1.3);
    g.addEdge({
      id: `pune-road-${a}-${b}`, u: na.id, v: nb.id, name, distanceKm: km, baseSpeedKmph: speed, roadType: type,
      trafficLevel: 'LOW', congestionPct: 0.08 + r() * 0.14, closed: false,
      riskScore: type === 'highway' ? 0.1 + r() * 0.05 : type === 'arterial' ? 0.15 + r() * 0.08 : 0.25 + r() * 0.1,
    }, true);
  }
}

export function buildIndiaGraph(): RoadGraph {
  const g = new RoadGraph();
  const rand = mulberry32(7);
  const cityHubNode: Record<string, string> = {};

  for (const city of INDIA_CITIES) {
    const hubId = `${city.key}-hub`;
    g.addNode({ id: hubId, lat: city.lat, lon: city.lon, name: `${city.name} Central` });
    cityHubNode[city.key] = hubId;

    const areaNodes: GraphNode[] = city.areas.map((a, i) => ({
      id: `${city.key}-area-${i}`, lat: a.lat, lon: a.lon, name: a.name,
    }));
    areaNodes.forEach((n) => g.addNode(n));

    // spokes: hub -> every area
    areaNodes.forEach((n) => {
      const dist = haversineKm(city.lat, city.lon, n.lat, n.lon);
      g.addEdge({
        id: `${city.key}-spoke-${n.id}`, u: hubId, v: n.id, name: `${pick(ROAD_NAMES, rand)} (${city.name})`,
        distanceKm: Math.max(0.5, dist), baseSpeedKmph: pick([40, 50, 60], rand),
        roadType: 'arterial', trafficLevel: 'LOW', congestionPct: 0.1 + rand() * 0.15, closed: false,
        riskScore: 0.15 + rand() * 0.1,
      }, true);
    });

    // ring: connect consecutive areas (local roads)
    for (let i = 0; i < areaNodes.length; i++) {
      const a = areaNodes[i];
      const b = areaNodes[(i + 1) % areaNodes.length];
      if (a.id === b.id) continue;
      const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
      g.addEdge({
        id: `${city.key}-ring-${i}`, u: a.id, v: b.id, name: `${pick(ROAD_NAMES, rand)} Link`,
        distanceKm: Math.max(0.5, dist), baseSpeedKmph: pick([25, 30, 35], rand),
        roadType: 'local', trafficLevel: 'LOW', congestionPct: 0.1 + rand() * 0.2, closed: false,
        riskScore: 0.25 + rand() * 0.15,
      }, true);
    }
  }

  addPuneCorridors(g);

  // approximate inter-city highway links (straight-line, clearly a rough
  // fallback approximation - not meant to compete with TomTom/OSRM accuracy)
  for (let i = 0; i < INDIA_CITIES.length; i++) {
    for (let j = i + 1; j < INDIA_CITIES.length; j++) {
      const a = INDIA_CITIES[i], b = INDIA_CITIES[j];
      const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (dist > 1500) continue; // skip absurdly long cross-country links
      g.addEdge({
        id: `hwy-${a.key}-${b.key}`, u: cityHubNode[a.key], v: cityHubNode[b.key],
        name: `${pick(ROAD_NAMES, rand)} National Highway`, distanceKm: dist, baseSpeedKmph: 80,
        roadType: 'highway', trafficLevel: 'LOW', congestionPct: 0.1, closed: false, riskScore: 0.1,
      }, true);
    }
  }

  return g;
}

export function findNearestCity(lat: number, lon: number): CityDef {
  let best = INDIA_CITIES[0], bestD = Infinity;
  for (const c of INDIA_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
