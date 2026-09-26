export interface CityStop {
  label: string;
  lat: number;
  lon: number;
}

export const CITY_CENTERS: Record<string, { lat: number; lon: number }> = {
  Pune: { lat: 18.5204, lon: 73.8567 },
  Delhi: { lat: 28.6139, lon: 77.2090 },
  Bangalore: { lat: 12.9716, lon: 77.5946 },
  Jaipur: { lat: 26.9124, lon: 75.7873 },
  Mumbai: { lat: 19.0760, lon: 72.8777 }
};

export const MULTI_CITY_STOPS: Record<string, CityStop[]> = {
  'Pune': [
    { label: 'Shivajinagar', lat: 18.5204, lon: 73.8567 },
    { label: 'Hinjewadi', lat: 18.5912, lon: 73.7389 },
    { label: 'Wakad', lat: 18.5978, lon: 73.7645 },
    { label: 'Baner', lat: 18.559, lon: 73.7869 },
    { label: 'Kothrud', lat: 18.5074, lon: 73.8077 },
    { label: 'Hadapsar', lat: 18.5089, lon: 73.926 },
    { label: 'Swargate', lat: 18.501, lon: 73.858 },
    { label: 'Viman Nagar', lat: 18.5679, lon: 73.9143 },
    { label: 'Magarpatta', lat: 18.5115, lon: 73.9285 },
    { label: 'Pimpri', lat: 18.6186, lon: 73.7999 },
    { label: 'Chinchwad', lat: 18.6399, lon: 73.7978 },
    { label: 'Kondhwa', lat: 18.4659, lon: 73.8914 }
  ],
  'Mumbai': [
    { label: 'Andheri', lat: 19.1197, lon: 72.8468 },
    { label: 'Bandra', lat: 19.0596, lon: 72.8295 },
    { label: 'Dadar', lat: 19.0176, lon: 72.8431 },
    { label: 'Powai', lat: 19.1176, lon: 72.9060 },
    { label: 'Worli', lat: 19.0176, lon: 72.8161 },
    { label: 'Borivali', lat: 19.2307, lon: 72.8567 },
    { label: 'Kurla', lat: 19.0726, lon: 72.8794 },
    { label: 'Thane', lat: 19.2183, lon: 72.9781 },
    { label: 'Navi Mumbai', lat: 19.0330, lon: 73.0297 },
    { label: 'Chembur', lat: 19.0622, lon: 72.9005 },
    { label: 'Malad', lat: 19.1870, lon: 72.8478 },
    { label: 'Goregaon', lat: 19.1663, lon: 72.8526 }
  ],
  'Delhi': [
    { label: 'Connaught Place', lat: 28.6315, lon: 77.2167 },
    { label: 'Dwarka', lat: 28.5921, lon: 77.0460 },
    { label: 'Gurugram', lat: 28.4595, lon: 77.0266 },
    { label: 'Noida', lat: 28.5355, lon: 77.3910 },
    { label: 'Saket', lat: 28.5245, lon: 77.2066 },
    { label: 'Rohini', lat: 28.7041, lon: 77.1025 },
    { label: 'Laxmi Nagar', lat: 28.6284, lon: 77.2763 },
    { label: 'Pitampura', lat: 28.7009, lon: 77.1308 },
    { label: 'Janakpuri', lat: 28.6219, lon: 77.0862 },
    { label: 'Nehru Place', lat: 28.5486, lon: 77.2510 },
    { label: 'Karol Bagh', lat: 28.6513, lon: 77.1910 },
    { label: 'Vasant Kunj', lat: 28.5228, lon: 77.1574 }
  ],
  'Bangalore': [
    { label: 'Whitefield', lat: 12.9698, lon: 77.7500 },
    { label: 'Koramangala', lat: 12.9352, lon: 77.6245 },
    { label: 'Indiranagar', lat: 12.9784, lon: 77.6408 },
    { label: 'Electronic City', lat: 12.8452, lon: 77.6602 },
    { label: 'Jayanagar', lat: 12.9308, lon: 77.5838 },
    { label: 'Hebbal', lat: 13.0358, lon: 77.5970 },
    { label: 'Marathahalli', lat: 12.9591, lon: 77.6974 },
    { label: 'JP Nagar', lat: 12.9073, lon: 77.5832 },
    { label: 'Yelahanka', lat: 13.1005, lon: 77.5963 },
    { label: 'Bannerghatta', lat: 12.8652, lon: 77.5972 },
    { label: 'Rajajinagar', lat: 12.9904, lon: 77.5513 },
    { label: 'Sarjapur Road', lat: 12.9121, lon: 77.6710 }
  ],
  'Jaipur': [
    { label: 'Malviya Nagar', lat: 26.8514, lon: 75.8055 },
    { label: 'Vaishali Nagar', lat: 26.9123, lon: 75.7377 },
    { label: 'Bani Park', lat: 26.9248, lon: 75.7951 },
    { label: 'Civil Lines', lat: 26.9124, lon: 75.8139 },
    { label: 'Mansarovar', lat: 26.8570, lon: 75.7630 },
    { label: 'Sodala', lat: 26.9004, lon: 75.7746 },
    { label: 'Sitapura', lat: 26.7922, lon: 75.8652 },
    { label: 'Sanganer', lat: 26.8173, lon: 75.8046 },
    { label: 'Jagatpura', lat: 26.8249, lon: 75.8563 },
    { label: 'Tonk Road', lat: 26.8659, lon: 75.8099 },
    { label: 'Gopalpura', lat: 26.8785, lon: 75.7827 },
    { label: 'Durgapura', lat: 26.8604, lon: 75.8201 }
  ]
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ResolvedMissionRoute {
  taskId: string;
  title: string;
  origin: string;
  destination: string;
  originCoords: { lat: number; lon: number };
  destCoords: { lat: number; lon: number };
  city: string;
  stops?: CityStop[];
}

export function findNearestCityStop(coord: { lat: number; lon: number }, cityHint?: string): { city: string; stop: CityStop } {
  let bestDist = Infinity;
  let bestCity = cityHint && MULTI_CITY_STOPS[cityHint] ? cityHint : 'Pune';
  let bestStop = MULTI_CITY_STOPS[bestCity][0];

  const searchCities = cityHint && MULTI_CITY_STOPS[cityHint]
    ? [cityHint, ...Object.keys(MULTI_CITY_STOPS).filter(c => c !== cityHint)]
    : Object.keys(MULTI_CITY_STOPS);

  for (const c of searchCities) {
    for (const s of MULTI_CITY_STOPS[c] || []) {
      const d = haversineKm(coord.lat, coord.lon, s.lat, s.lon);
      if (d < bestDist) {
        bestDist = d;
        bestCity = c;
        bestStop = s;
      }
    }
  }
  return { city: bestCity, stop: bestStop };
}

const isGeneric = (str?: string) => !str || /^(stop|pickup|dropoff|location|source|destination|stop to stop)$/i.test(str.trim());

export function resolveMissionRoute(notification: any, fallbackCity = 'Pune'): ResolvedMissionRoute {
  const payload = notification?.payload;
  let origin = payload?.source?.name;
  let destination = payload?.destination?.name;
  let oCoords: { lat: number; lon: number } | null =
    payload?.source?.lat && (payload?.source?.lng || payload?.source?.lon)
      ? { lat: payload.source.lat, lon: payload.source.lng || payload.source.lon }
      : null;
  let dCoords: { lat: number; lon: number } | null =
    payload?.destination?.lat && (payload?.destination?.lng || payload?.destination?.lon)
      ? { lat: payload.destination.lat, lon: payload.destination.lng || payload.destination.lon }
      : null;
  let taskId = payload?.taskId;

  const text = (notification?.message || notification?.text || '') as string;

  // Extract from message regex if not already found in payload
  if (!origin || !destination || isGeneric(origin) || isGeneric(destination)) {
    const routeMatch = text.match(/Route:\s*([^to\n\r]+?)\s+to\s+([^\n\r]+)/i);
    if (routeMatch) {
      const parsedO = routeMatch[1].trim();
      const parsedD = routeMatch[2].trim();
      if (!isGeneric(parsedO)) origin = parsedO;
      if (!isGeneric(parsedD)) destination = parsedD;
    }
  }

  if (!taskId) {
    const taskMatch = text.match(/Task\s*ID:\s*([A-Za-z0-9\-_]+)/i);
    if (taskMatch) {
      taskId = taskMatch[1].trim();
    }
  }

  let detectedCity = fallbackCity;

  // 1. Scan MULTI_CITY_STOPS if origin or destination has a known landmark name
  for (const [cityName, stops] of Object.entries(MULTI_CITY_STOPS)) {
    const foundO = origin && !isGeneric(origin) ? stops.find(s => s.label.toLowerCase() === origin.toLowerCase()) : null;
    const foundD = destination && !isGeneric(destination) ? stops.find(s => s.label.toLowerCase() === destination.toLowerCase()) : null;
    if (foundO || foundD) {
      detectedCity = cityName;
      if (!oCoords && foundO) oCoords = { lat: foundO.lat, lon: foundO.lon };
      if (!dCoords && foundD) dCoords = { lat: foundD.lat, lon: foundD.lon };
      break;
    }
  }

  // 2. If coordinates exist, map them to real landmarks if names were generic
  if (oCoords) {
    const nearestO = findNearestCityStop(oCoords, detectedCity);
    detectedCity = nearestO.city;
    if (isGeneric(origin)) {
      origin = nearestO.stop.label;
    }
  }

  if (dCoords) {
    const nearestD = findNearestCityStop(dCoords, detectedCity);
    if (isGeneric(destination) || destination.toLowerCase() === origin?.toLowerCase()) {
      destination = nearestD.stop.label;
    }
  }

  // 3. Fallbacks to ensure distinct origin & destination in detected city
  const cityStops = MULTI_CITY_STOPS[detectedCity] || MULTI_CITY_STOPS['Pune'];

  if (isGeneric(origin)) {
    origin = cityStops[0].label;
    oCoords = { lat: cityStops[0].lat, lon: cityStops[0].lon };
  } else if (!oCoords) {
    const match = cityStops.find(s => s.label.toLowerCase() === origin.toLowerCase());
    oCoords = match ? { lat: match.lat, lon: match.lon } : { lat: cityStops[0].lat, lon: cityStops[0].lon };
  }

  if (isGeneric(destination) || destination.toLowerCase() === origin.toLowerCase()) {
    const secondStop = cityStops.find(s => s.label.toLowerCase() !== origin.toLowerCase()) || cityStops[1] || cityStops[0];
    destination = secondStop.label;
    dCoords = { lat: secondStop.lat, lon: secondStop.lon };
  } else if (!dCoords) {
    const match = cityStops.find(s => s.label.toLowerCase() === destination.toLowerCase());
    dCoords = match ? { lat: match.lat, lon: match.lon } : { lat: cityStops[1]?.lat || cityStops[0].lat, lon: cityStops[1]?.lon || cityStops[0].lon };
  }

  return {
    taskId: taskId || `TASK-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    title: payload?.title || notification?.title || 'Emergency Route Clearance / Delivery',
    origin,
    destination,
    originCoords: oCoords,
    destCoords: dCoords,
    city: detectedCity,
    stops: payload?.stops || undefined,
  };
}
