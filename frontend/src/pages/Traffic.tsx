import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Radio, Zap, AlertTriangle, Construction, Clock, CloudRain, Shuffle } from 'lucide-react'
import api from '../api/client'
import { GlassCard, PrimaryButton, Badge } from '../components/ui'
import QRouteMap from '../components/QRouteMap'

const SCENARIOS = [
  { key: 'ACCIDENT', label: 'Accident', icon: AlertTriangle },
  { key: 'ROAD_CLOSURE', label: 'Road Closure', icon: Construction },
  { key: 'RUSH_HOUR', label: 'Rush Hour', icon: Clock },
  { key: 'HEAVY_RAIN', label: 'Heavy Rain', icon: CloudRain },
  { key: 'RANDOM_CONGESTION', label: 'Random Congestion', icon: Shuffle },
]

const CITIES = [
  { key: 'pune', name: 'Pune', lat: 18.5204, lon: 73.8567 },
  { key: 'delhi', name: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { key: 'bengaluru', name: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { key: 'jaipur', name: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { key: 'mumbai', name: 'Mumbai', lat: 19.0760, lon: 72.8777 }
]

export default function Traffic() {
  const qc = useQueryClient()
  const [currentCity, setCurrentCity] = useState(() => localStorage.getItem('quantara_city') || 'Pune');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState(() => {
    const saved = localStorage.getItem('quantara_city');
    return CITIES.find(c => c.name === saved) || CITIES[0];
  });

  useEffect(() => {
    const handleGlobalCityChange = (e: Event) => {
      const cityStr = (e as CustomEvent).detail?.city;
      if (!cityStr) return;
      const c = CITIES.find(x => x.name === cityStr);
      if (c && c.name !== selectedCity.name) {
        setSelectedCity(c);
      }
    };
    window.addEventListener('quantara:city-change', handleGlobalCityChange);
    return () => window.removeEventListener('quantara:city-change', handleGlobalCityChange);
  }, [selectedCity.name]);

  const { data: traffic } = useQuery({ queryKey: ['traffic-page', selectedCity.key], queryFn: async () => (await api.get(`/traffic?lat=${selectedCity.lat}&lon=${selectedCity.lon}`)).data, refetchInterval: 6000 })
  const { data: incidents } = useQuery({ queryKey: ['incidents-page', selectedCity.key], queryFn: async () => (await api.get(`/traffic/incidents?lat=${selectedCity.lat}&lon=${selectedCity.lon}`)).data, refetchInterval: 6000 })
  const { data: weather } = useQuery({ queryKey: ['weather-page', selectedCity.key], queryFn: async () => (await api.get(`/weather?lat=${selectedCity.lat}&lon=${selectedCity.lon}`)).data, refetchInterval: 60000 })

  const simulate = useMutation({
    mutationFn: async (scenarioType: string) => (await api.post('/traffic/simulate', { scenarioType, cityKey: selectedCity.key })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['traffic-page'] }); qc.invalidateQueries({ queryKey: ['incidents-page'] }) },
  })

  const resolve = useMutation({
    mutationFn: async (id: string) => (await api.post(`/traffic/incidents/${id}/resolve`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['traffic-page'] }); qc.invalidateQueries({ queryKey: ['incidents-page'] }) },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Radio className="text-accent" size={22} /> Traffic Monitoring</h1>
          <p className="text-slate-500 text-sm">{traffic?.source === 'LIVE' ? 'Live TomTom traffic data' : 'Simulated traffic engine (TomTom not configured)'} · avg congestion {traffic?.avgCongestionPct ?? 0}%</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedCity.key} onChange={e => { 
            const c = CITIES.find(x => x.key === e.target.value); 
            if(c) {
              setSelectedCity(c);
              localStorage.setItem('quantara_city', c.name);
              window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: c.name } }));
            }
          }} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200">
             {CITIES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <Badge tone={traffic?.source === 'LIVE' ? 'green' : 'purple'}>{traffic?.source || 'SIMULATED'}</Badge>
        </div>
      </div>

      {
        <GlassCard>
          <div className="flex items-center gap-2 mb-3"><Zap size={14} className="text-accent" /><h3 className="text-sm font-medium text-slate-300">Toggle simulation scenarios</h3></div>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((s) => {
              const activeIncident = (incidents?.incidents || []).find((i: any) => i.type === s.key)
              return (
                <PrimaryButton key={s.key} onClick={() => { if (activeIncident) resolve.mutate(activeIncident.id); else simulate.mutate(s.key); }} disabled={simulate.isPending || resolve.isPending}
                  className={`flex items-center gap-2 transition ${activeIncident ? '!bg-none !bg-red-900/80 border-red-500/50 hover:!bg-red-900 !text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : ''}`}>
                  <s.icon size={13} /> {s.label}
                </PrimaryButton>
              )
            })}
          </div>
        </GlassCard>
      }

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassCard className="lg:col-span-2 p-0 overflow-hidden h-[420px]">
          <QRouteMap height="100%" incidents={(incidents?.incidents || []).filter((i:any)=>i.lat&&i.lon&&(!selectedId||i.id===selectedId)).map((i:any)=>({id:i.id,lat:i.lat,lon:i.lon,label:i.description||'Affected road',type:i.type,severity:i.severity}))} onIncidentDoubleClick={(id) => { resolve.mutate(id); setSelectedId(null); }} />
        </GlassCard>
        <div className="flex flex-col gap-6">
          <GlassCard>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Active Incidents ({incidents?.incidents?.length ?? 0})</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(incidents?.incidents || []).map((i: any) => (
                <div key={i.id} onClick={() => setSelectedId(selectedId === i.id ? null : i.id)} className={`flex items-center justify-between text-xs border-b border-slate-800/60 pb-2 cursor-pointer p-2 rounded transition-colors ${selectedId === i.id ? 'bg-accent/10 border-accent/30' : 'hover:bg-slate-800/40'}`}>
                  <div><div className="text-slate-200">{i.type?.replace('_', ' ')}</div><div className="text-slate-500">{i.description}</div></div>
                  <Badge tone={i.severity === 'HIGH' || i.severity === 'SEVERE' ? 'red' : 'yellow'}>{i.severity}</Badge>
                </div>
              ))}
              {(!incidents?.incidents || incidents.incidents.length === 0) && <div className="text-xs text-slate-600">No active incidents. Trigger one above.</div>}
            </div>
          </GlassCard>
          
          <GlassCard>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Road Health & Weather</h3>
            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
              <div className="bg-slate-900/40 p-3 rounded-lg"><div className="text-slate-500">Congestion</div><div className="text-lg text-slate-200">{traffic?.avgCongestionPct ?? 0}%</div></div>
              <div className="bg-slate-900/40 p-3 rounded-lg"><div className="text-slate-500">Traffic Model</div><div className="text-slate-200 truncate">{traffic?.source}</div></div>
            </div>
            <div className="bg-slate-900/60 rounded-xl p-4 flex items-center justify-between border border-slate-800">
              <div className="flex items-center gap-3">
                <CloudRain size={24} className="text-accent" />
                <div>
                  <div className="text-sm font-semibold">{selectedCity.name} Region</div>
                  <div className="text-[10px] text-slate-400">Open-Meteo Integration</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold text-slate-200">{weather?.temperature != null ? `${weather.temperature}°C` : '—'}</div>
                <div className="text-[10px] text-slate-400 capitalize">{weather?.condition?.replace('_', ' ') || 'Unknown'}</div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      <GlassCard className="border-accent/20">
        <p className="text-xs text-slate-400">
          After triggering a scenario, head to <b className="text-accent">Plan & Optimize</b> and re-run the optimizer on the
          same trip — the new route reflects the updated traffic instantly, since both read from the same live graph.
        </p>
      </GlassCard>
    </div>
  )
}
