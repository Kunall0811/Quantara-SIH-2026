import React, { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { GhostButton } from '../components/ui';
import { useSocket } from '../lib/useSocket';
import QRouteMap from '../components/QRouteMap';

// City coordinates mapping for India
const CITY_COORDS: Record<string, [number, number]> = {
  'Pune': [18.5204, 73.8567],
  'Jaipur': [26.9124, 75.7873],
  'Delhi': [28.6139, 77.2090],
  'Bangalore': [12.9716, 77.5946],
  'Mumbai': [19.0760, 72.8777]
};

export default function Weather() {
  const { socket } = useSocket();
  const [events, setEvents] = useState<any[]>([]);
  const [risk, setRisk] = useState<any>(null);
  const [eventStream, setEventStream] = useState<any[]>([]);
  
  // Track active city and coords
  const [city, setCity] = useState<string>(() => localStorage.getItem('quantara_city') || 'Pune');
  const [coords, setCoords] = useState<[number, number]>(() => CITY_COORDS[localStorage.getItem('quantara_city') || 'Pune'] || [18.5204, 73.8567]);

  // Listen to city change events from topbar
  useEffect(() => {
    const handleCityChange = (e: Event) => {
      const newCity = (e as CustomEvent).detail?.city;
      if (newCity && CITY_COORDS[newCity]) {
        setCity(newCity);
        setCoords(CITY_COORDS[newCity]);
      }
    };
    window.addEventListener('quantara:city-change', handleCityChange);
    return () => window.removeEventListener('quantara:city-change', handleCityChange);
  }, []);

  // Fetch real-time weather based on current city coordinates
  const { data: weatherData, refetch: refetchWeather } = useQuery({
    queryKey: ['liveWeather', coords],
    queryFn: async () => {
      const res = await api.get(`/weather?lat=${coords[0]}&lon=${coords[1]}`);
      return res.data;
    },
    refetchInterval: 300000 // Refetch every 5 minutes automatically
  });

  // Initial intelligence events/risk
  useEffect(() => {
    api.get('/intelligence/events').then(res => setEvents(res.data.events || []));
    api.get('/intelligence/risk').then(res => setRisk(res.data.risk || { score: 10, level: 'LOW', factors: [] }));
  }, []);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;
    
    const handleUpdate = (data: any) => {
      if (data.type === 'NEW_EVENT') {
        setEvents(prev => [data.event, ...prev.filter(e => e._id !== data.event._id)]);
        setEventStream(prev => [{ time: new Date().toLocaleTimeString(), msg: `${data.event.type} reported at ${data.event.roadSegment || 'unknown location'}` }, ...prev].slice(0, 10));
      }
    };
    const handleRisk = (data: any) => setRisk(data);
    const handleCascade = (data: any) => {
      setEventStream(prev => [{ time: new Date().toLocaleTimeString(), msg: data.message }, ...prev].slice(0, 10));
      // Re-fetch weather if a weather cascade occurs
      refetchWeather();
    };

    socket.on('intelligence_update', handleUpdate);
    socket.on('intelligence_risk_update', handleRisk);
    socket.on('cascade_event', handleCascade);

    return () => {
      socket.off('intelligence_update', handleUpdate);
      socket.off('intelligence_risk_update', handleRisk);
      socket.off('cascade_event', handleCascade);
    };
  }, [socket, refetchWeather]);

  const runCascade = (scenario: string) => {
    api.post('/intelligence/simulate', { isCascade: true, scenario, location: { lat: coords[0], lon: coords[1] }, roadSegment: 'City Center' });
  };

  const getSeverityColor = (sev: string) => {
    if (sev === 'CRITICAL' || sev === 'SEVERE') return 'text-red-500 bg-red-500/10 border-red-500/30';
    if (sev === 'HIGH') return 'text-orange-400 bg-orange-400/10 border-orange-400/30';
    if (sev === 'MODERATE') return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
    return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  };

  // Derived real-time weather values
  const currentTemp = weatherData?.current?.temperature ?? weatherData?.temperature ?? '--';
  const currentRain = weatherData?.current?.rain ? 'Heavy' : (weatherData?.rainMm > 0 ? `${weatherData?.rainMm} mm/h` : '0 mm/h');
  const visibilityCode = weatherData?.current?.weatherCode ?? weatherData?.weatherCode ?? 0;
  
  let visibilityDesc = 'Clear (10km)';
  let roadSurface = 'Dry';
  
  if (visibilityCode >= 45 && visibilityCode <= 48) { visibilityDesc = 'Low (Fog)'; }
  if (visibilityCode >= 61 && visibilityCode <= 65) { visibilityDesc = 'Medium (Rain)'; roadSurface = 'Wet'; }
  if (visibilityCode >= 80) { visibilityDesc = 'Very Low (Storm)'; roadSurface = 'Slippery'; }
  if (weatherData?.current?.condition === 'Dense Fog') { visibilityDesc = 'Low (Dense Fog)'; }
  if (weatherData?.current?.condition === 'Heavy Rain') { visibilityDesc = 'Low (Heavy Rain)'; roadSurface = 'Waterlogged'; }
  
  // No air-quality provider is integrated, so AQI is reported as unavailable instead of being invented.
  const aqiValue = weatherData?.aqi ?? null;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full flex flex-col h-[90vh] gap-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">ROAD & ENVIRONMENT INTELLIGENCE</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-slate-400 text-sm font-semibold tracking-wider">LIVE • Monitoring {city.toUpperCase()} Active</span>
          </div>
        </div>
        
        {/* Admin Simulation Controls */}
        <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-700 flex gap-2">
           <span className="text-xs text-slate-500 self-center uppercase mx-2">Admin Simulation:</span>
           <GhostButton onClick={() => runCascade('HeavyRainCascade')} className="text-xs px-4 py-2 border-slate-700 hover:border-blue-500 hover:text-blue-400">Trigger Flood Cascade</GhostButton>
           <GhostButton onClick={() => api.post('/intelligence/simulate', { category: 'OBSTACLE', type: 'Fallen Tree', severity: 'HIGH', location: { lat: coords[0], lon: coords[1] }, roadSegment: `${city} Main Road` })} className="text-xs px-4 py-2 border-slate-700 hover:border-orange-500 hover:text-orange-400">Spawn Tree Obstacle</GhostButton>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        
        {/* Left Column: Risk & Map */}
        <div className="lg:col-span-3 flex flex-col gap-6 h-full">
          {/* Top Metrics Row */}
          <div className="grid grid-cols-4 gap-4 shrink-0">
             {/* Unified Risk Score */}
             <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/80 shadow-lg flex flex-col justify-center relative overflow-hidden">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Unified Road Risk</div>
                <div className="flex items-end gap-2 mt-1">
                  <div className={`text-4xl font-bold ${getSeverityColor(risk?.level || 'LOW').split(' ')[0]}`}>{risk?.score || 10}</div>
                  <div className="text-slate-500 mb-1">/ 100</div>
                </div>
                <div className={`text-xs mt-1 font-bold ${getSeverityColor(risk?.level || 'LOW').split(' ')[0]}`}>{risk?.level || 'LOW'} RISK</div>
             </div>

             {/* Environment Data */}
             <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/80 shadow-lg col-span-3">
               <div className="text-[10px] text-slate-400 uppercase font-semibold mb-3">Live Environmental Conditions - {city}</div>
               <div className="grid grid-cols-5 gap-4">
                 <div>
                   <div className="text-xs text-slate-500">Temperature</div>
                   <div className="text-lg font-semibold text-slate-200">{currentTemp}°C</div>
                 </div>
                 <div>
                   <div className="text-xs text-slate-500">Rainfall</div>
                   <div className="text-lg font-semibold text-blue-400">{currentRain}</div>
                 </div>
                 <div>
                   <div className="text-xs text-slate-500">Visibility</div>
                   <div className="text-lg font-semibold text-slate-200">{visibilityDesc}</div>
                 </div>
                 <div>
                   <div className="text-xs text-slate-500">AQI</div>
                   <div className={`text-lg font-semibold ${aqiValue == null ? 'text-slate-500' : 'text-yellow-400'}`} title={aqiValue == null ? 'No air-quality provider is configured' : undefined}>{aqiValue ?? 'n/a'}</div>
                 </div>
                 <div>
                   <div className="text-xs text-slate-500">Road Surface</div>
                   <div className="text-lg font-semibold text-cyan-400">{roadSurface}</div>
                 </div>
               </div>
             </div>
          </div>

          {/* Interactive Map */}
          <div className="flex-1 bg-slate-900 rounded-xl border border-slate-700/80 shadow-lg overflow-hidden relative">
             {/* Map overlays / indicators */}
             <div className="absolute top-4 left-4 z-10 flex gap-2">
               <span className="px-3 py-1 bg-black/60 border border-slate-700 rounded-full text-xs text-slate-300 font-semibold backdrop-blur-md">LIVE INCIDENT MAP</span>
             </div>
             
             {/* Replace with actual map component mapping the new events */}
             <QRouteMap origin={null} waypoints={[]} intelligenceEvents={events} fitRoute />
          </div>
        </div>

        {/* Right Column: Feed & Details */}
        <div className="flex flex-col gap-6 h-full overflow-hidden">
          
          {/* Risk Factors Breakdown */}
          <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/80 shadow-lg shrink-0">
             <div className="text-[10px] text-slate-400 uppercase font-semibold mb-3">Risk Factor Breakdown</div>
             <div className="flex flex-col gap-2">
               {(risk?.factors || []).map((f: any, i: number) => (
                 <div key={i} className="flex justify-between items-center text-sm border-b border-slate-800 pb-2">
                   <span className="text-slate-300">{f.reason}</span>
                   <span className="text-red-400 font-mono">+{f.impact}</span>
                 </div>
               ))}
               {(!risk?.factors || risk.factors.length === 0) && (
                 <div className="text-sm text-slate-500">Normal operations</div>
               )}
             </div>
          </div>

          {/* Active Incidents */}
          <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/80 shadow-lg flex-1 flex flex-col overflow-hidden">
             <div className="text-[10px] text-slate-400 uppercase font-semibold mb-3 shrink-0 flex justify-between">
               <span>Active Incidents</span>
               <span className="text-blue-400">{events.length}</span>
             </div>
             <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
               {events.map((e, i) => (
                 <div key={i} className={`p-3 rounded-lg border ${getSeverityColor(e.severity)}`}>
                   <div className="flex justify-between items-start">
                     <span className="font-semibold text-sm">{e.type}</span>
                     <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 uppercase tracking-wider">{e.severity}</span>
                   </div>
                   <div className="text-xs mt-1 opacity-80">{e.roadSegment || 'Unknown Location'}</div>
                   <div className="flex justify-between items-center mt-2 text-[10px] uppercase font-semibold">
                     <span className="opacity-60">{e.status}</span>
                     <span className="opacity-60">{e.confidence}% CONF. • {e.isSimulated ? 'SIMULATED' : 'LIVE'}</span>
                   </div>
                 </div>
               ))}
               {events.length === 0 && (
                 <div className="text-sm text-slate-500 text-center py-4">No active incidents detected.</div>
               )}
             </div>
          </div>

          {/* Live Event Stream */}
          <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/80 shadow-lg h-48 shrink-0 flex flex-col">
             <div className="text-[10px] text-slate-400 uppercase font-semibold mb-3 shrink-0">Live Event Stream</div>
             <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs custom-scrollbar">
               {eventStream.map((ev, i) => (
                 <div key={i} className="flex gap-2">
                   <span className="text-slate-500 shrink-0">{ev.time}</span>
                   <span className="text-slate-300">{ev.msg}</span>
                 </div>
               ))}
               {eventStream.length === 0 && <div className="text-slate-600">Awaiting events...</div>}
             </div>
          </div>

          {/* Data Sources Drawer Toggle (Mocked as static for now) */}
          <div className="text-center shrink-0">
             <button className="text-xs text-slate-500 hover:text-blue-400 transition-colors uppercase tracking-wider font-semibold underline underline-offset-4">
               View Data Sources Status
             </button>
          </div>

        </div>
      </div>
    </div>
  );
}
