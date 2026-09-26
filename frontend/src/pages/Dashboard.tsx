import React, { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowRight, Bot, Clock3, Gauge, MapPinned, Navigation, Package, Radio, Route as RouteIcon, ShieldCheck, Sparkles, Truck, Zap, Sliders, Settings2, Bell, CloudRain } from 'lucide-react'
import api from '../api/client'
import { GlassCard, KpiCard, Badge, PrimaryButton, GhostButton, Input, Select } from '../components/ui'
import { useAuthStore } from '../store/authStore'
import QRouteMap, { FleetVehicle } from '../components/QRouteMap'
import { useSocket } from '../lib/useSocket'
import SearchControl from '../components/SearchControl'
import { useOptimizationStore } from '../store/optimizationStore'

import { CITY_CENTERS, MULTI_CITY_STOPS, haversineKm } from '../lib/missionResolver'

function timeAgo(iso?: string) {
  if (!iso) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  return sec < 3 ? 'just now' : `${sec}s ago`
}


function CitizenDelivery() {
  const location = useLocation();
  const { logout, pendingMission, setPendingMission } = useAuthStore();
  const [currentCity, setCurrentCity] = React.useState(() => localStorage.getItem('quantara_city') || 'Pune');
  const deliveryStops = MULTI_CITY_STOPS[currentCity] || MULTI_CITY_STOPS['Pune'];

  const [origin, setOrigin] = useState(deliveryStops[0].label);
  const [destination, setDestination] = useState(deliveryStops[1]?.label || deliveryStops[0].label);
  const [extraStops, setExtraStops] = useState<string[]>([]);
  const [packageInfo, setPackageInfo] = useState('Standard delivery');
  const [vehicleType, setVehicleType] = useState('delivery');
  const [route, setRoute] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [focus, setFocus] = useState<any>(null);
  const [missionPayload, setMissionPayload] = useState<any>(null);
  const [customPresets, setCustomPresets] = useState<Record<string, any>>({});
  const [acceptedMission, setAcceptedMission] = useState<any>(null);

  const cityCenter = CITY_CENTERS[currentCity] || CITY_CENTERS['Pune'];

  const { data: incidentsData } = useQuery({
    queryKey: ['citizen-incidents', currentCity],
    queryFn: async () => (await api.get(`/traffic/incidents?lat=${cityCenter.lat}&lon=${cityCenter.lon}`)).data,
    refetchInterval: 15000,
  });
  const incidents = (incidentsData?.incidents || []).filter((i: any) => i.lat && i.lon);

  const PRESETS = useMemo(() => {
    const p: Record<string, any> = { ...customPresets };
    deliveryStops.forEach(s => { p[s.label] = { lat: s.lat, lon: s.lon, label: s.label }; });
    return p;
  }, [deliveryStops, customPresets]);

  const allStopLabels = useMemo(() => [origin, ...extraStops, destination], [origin, extraStops, destination]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const points = allStopLabels.map(l => PRESETS[l]).filter(Boolean);
      if (points.length >= 2) {
        const r = await api.post('/routes/calculate-through', { points });
        if (r.data?.geometry?.length >= 2) {
          setRoute({
            ...r.data,
            geometry: r.data.geometry.map((p: any) => ({
              lat: p.lat,
              lon: typeof p.lon === 'number' ? p.lon : p.lng,
              lng: typeof p.lon === 'number' ? p.lon : p.lng
            }))
          });
        }
      }
    } catch (e) {} finally { setLoading(false); }
  }, [allStopLabels, PRESETS]);

  const [trackingId, setTrackingId] = useState<number | null>(null);

  React.useEffect(() => {
    const handleCityChange = (e: Event) => {
      const city = (e as CustomEvent).detail?.city;
      if (city && MULTI_CITY_STOPS[city]) {
        setCurrentCity(city);
        setOrigin(MULTI_CITY_STOPS[city][0].label);
        setDestination(MULTI_CITY_STOPS[city][1]?.label || MULTI_CITY_STOPS[city][0].label);
        setExtraStops([]);
        setRoute(null);
      }
    };
    window.addEventListener('quantara:city-change', handleCityChange);
    return () => window.removeEventListener('quantara:city-change', handleCityChange);
  }, []);

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, [load]);

  React.useEffect(() => {
    const override = location.state?.routeOverride;
    if (!override) return;

    const targetCity = override.city || currentCity;
    if (targetCity && targetCity !== currentCity && MULTI_CITY_STOPS[targetCity]) {
      setCurrentCity(targetCity);
      localStorage.setItem('quantara_city', targetCity);
      window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: targetCity } }));
    }

    const cityStops = MULTI_CITY_STOPS[targetCity] || MULTI_CITY_STOPS['Pune'];
    const oPt = override.originCoords || cityStops.find((s: any) => s.label.toLowerCase() === override.origin?.toLowerCase()) || cityStops[0];
    const dPt = override.destCoords || cityStops.find((s: any) => s.label.toLowerCase() === override.destination?.toLowerCase()) || cityStops[1] || cityStops[0];

    const oLabel = override.origin || oPt.label || 'Pickup';
    const dLabel = override.destination || dPt.label || 'Dropoff';

    const oLon = typeof oPt.lon === 'number' ? oPt.lon : (oPt as any).lng;
    const dLon = typeof dPt.lon === 'number' ? dPt.lon : (dPt as any).lng;
    const oLat = typeof oPt.lat === 'number' ? oPt.lat : (oPt as any).lat;
    const dLat = typeof dPt.lat === 'number' ? dPt.lat : (dPt as any).lat;

    setCustomPresets(prev => ({
      ...prev,
      [oLabel]: { label: oLabel, lat: oLat, lon: oLon, lng: oLon },
      [dLabel]: { label: dLabel, lat: dLat, lon: dLon, lng: dLon }
    }));

    setOrigin(oLabel);
    setDestination(dLabel);
    setExtraStops([]);
    setAcceptedMission({
      taskId: override.taskId || 'TASK-ACTIVE',
      title: override.title || 'Emergency Route Clearance / Delivery',
      origin: oLabel,
      destination: dLabel,
      city: targetCity
    });

    // ─── INSTANT 0ms Map Line: Draw direct path immediately ───
    const distEst = Math.round(haversineKm(oLat, oLon, dLat, dLon) * 1.3 * 10) / 10;
    const durEst = Math.max(3, Math.round((distEst / 35) * 60));
    setRoute({
      geometry: [
        { lat: oLat, lon: oLon, lng: oLon },
        { lat: dLat, lon: dLon, lng: dLon }
      ],
      distanceKm: distEst,
      durationMinutes: durEst,
      interim: true
    });

    // ─── INSTANT Camera Bounds ───
    const minLon = Math.min(oLon, dLon);
    const maxLon = Math.max(oLon, dLon);
    const minLat = Math.min(oLat, dLat);
    const maxLat = Math.max(oLat, dLat);
    setFocus({
      bounds: [
        [minLon - 0.015, minLat - 0.015],
        [maxLon + 0.015, maxLat + 0.015]
      ]
    });

    window.history.replaceState({}, '');

    // ─── High-resolution road route calculation in background ───
    setLoading(true);
    api.post('/routes/calculate-through', {
      points: [
        { label: oLabel, lat: oLat, lon: oLon },
        { label: dLabel, lat: dLat, lon: dLon }
      ]
    }).then(res => {
      if (res.data?.geometry?.length >= 2) {
        setRoute({
          ...res.data,
          geometry: res.data.geometry.map((p: any) => ({
            lat: p.lat,
            lon: typeof p.lon === 'number' ? p.lon : p.lng,
            lng: typeof p.lon === 'number' ? p.lon : p.lng
          }))
        });
      }
    }).catch(err => {
      console.warn('Road network notice, interim route maintained:', err);
    }).finally(() => {
      setLoading(false);
    });
  }, [location.state]);

  React.useEffect(() => { if (pendingMission) setMissionPayload(pendingMission); }, [pendingMission]);

  const toggleTracking = () => {
    if (trackingId !== null) {
      navigator.geolocation.clearWatch(trackingId);
      setTrackingId(null); setTracking(false);
    } else {
      setTracking(true);
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          api.post('/fleet/citizen/gps', { lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading }).catch(() => {});
          setFocus({ lat: pos.coords.latitude, lon: pos.coords.longitude, zoom: 16 });
        },
        console.error, { enableHighAccuracy: true, maximumAge: 0 }
      );
      setTrackingId(id);
    }
  };

  const updateCitizenStatus = (status: 'ACCEPTED' | 'ON_ROUTE' | 'DELIVERED') => {
    api.post('/fleet/citizen/status', { status }).catch(console.error);
    if (status === 'DELIVERED') toggleTracking();
  };

  const MAX_EXTRA_STOPS = 10;
  const addExtraStop = () => {
    if (extraStops.length >= MAX_EXTRA_STOPS) return;
    // Pick first preset not already selected; if all used, repeat first preset (user can change it)
    const used = new Set([origin, ...extraStops, destination]);
    const next = deliveryStops.find(s => !used.has(s.label)) || deliveryStops[0];
    setExtraStops(prev => [...prev, next.label]);
  };

  const removeExtraStop = (idx: number) => setExtraStops(prev => prev.filter((_, i) => i !== idx));
  const updateExtraStop = (idx: number, val: string) => setExtraStops(prev => prev.map((s, i) => i === idx ? val : s));

  const mapWaypoints = useMemo(() =>
    allStopLabels.slice(1, -1).map(l => PRESETS[l]).filter(Boolean),
  [allStopLabels, PRESETS]);

  const totalDistance = route?.distanceKm ?? 0;
  const totalEta = route?.durationMinutes ? Math.round(route.durationMinutes) : 0;

  return <div className="absolute inset-0 flex flex-col md:flex-row">
    {missionPayload && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-slate-900 border border-red-500/50 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="bg-red-500/20 p-4 border-b border-red-500/30 flex items-center gap-3">
            <AlertTriangle className="text-red-400" size={24}/>
            <div>
              <div className="text-red-400 font-bold uppercase text-[10px] tracking-widest">Priority Dispatch</div>
              <div className="font-semibold text-slate-200">{missionPayload.title}</div>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between text-xs"><span className="text-slate-400">Task ID</span><span className="font-mono text-slate-200">{missionPayload.taskId}</span></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-800/50 p-2 rounded-lg border border-slate-700/50"><div className="text-slate-500 text-[10px] mb-1">ORIGIN</div><div className="font-medium">{missionPayload.source?.name}</div></div>
              <div className="bg-slate-800/50 p-2 rounded-lg border border-slate-700/50"><div className="text-slate-500 text-[10px] mb-1">DESTINATION</div><div className="font-medium">{missionPayload.destination?.name}</div></div>
            </div>
            <div className="flex gap-2 pt-2">
              <PrimaryButton className="flex-1 !bg-emerald-600 hover:!bg-emerald-500 !border-emerald-500" onClick={() => {
                updateCitizenStatus('ACCEPTED');
                if (missionPayload.source && missionPayload.destination) {
                  const oName = missionPayload.source.name || 'Mission Origin';
                  const dName = missionPayload.destination.name || 'Mission Destination';
                  setCustomPresets({ [oName]: { lat: missionPayload.source.lat, lon: missionPayload.source.lng || missionPayload.source.lon, label: oName }, [dName]: { lat: missionPayload.destination.lat, lon: missionPayload.destination.lng || missionPayload.destination.lon, label: dName } });
                  setOrigin(oName); setDestination(dName); setExtraStops([]);
                  setFocus({ bounds: [[missionPayload.source.lng || missionPayload.source.lon, missionPayload.source.lat], [missionPayload.destination.lng || missionPayload.destination.lon, missionPayload.destination.lat]] });
                }
                if (!trackingId) toggleTracking();
                setMissionPayload(null); setPendingMission(null);
              }}> [ Accept Task ] </PrimaryButton>
              <GhostButton className="flex-1 border border-slate-700 text-slate-300" onClick={() => setMissionPayload(null)}> [ Decline ] </GhostButton>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Sidebar */}
    <div className="w-full md:w-[400px] md:shrink-0 bg-base-950/95 backdrop-blur-xl border-b md:border-r border-slate-800/60 z-10 p-4 md:p-5 flex flex-col h-[55vh] md:h-full overflow-y-auto">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-accent mb-2"><Package size={13}/> Delivery Portal</div>
        <h1 className="font-display text-2xl font-semibold">Plan delivery</h1>
        <p className="text-slate-500 text-[11px] mt-1">QUANTARA handles live road routing, traffic and incident awareness · <span className="text-accent font-medium">{currentCity}</span></p>
      </div>

      <div className="mb-4 p-3 rounded-xl bg-slate-900/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Citizen" alt="Profile" className="w-full h-full object-cover"/>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-200">Citizen Courier</div>
            <div className="text-[10px] text-slate-500">ID: CTZ-9823 · Rating: 4.8★</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if (pendingMission) setMissionPayload(pendingMission); }} className="p-2 text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-800 rounded-lg transition relative">
            <Bell size={16}/>
            {pendingMission && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"/>}
          </button>
          <button onClick={logout} className="p-2 text-slate-500 hover:text-red-400 bg-slate-800/40 hover:bg-slate-800 rounded-lg transition">
            <div className="text-[10px] font-semibold">LOGOUT</div>
          </button>
        </div>
      </div>

      {acceptedMission && (
        <div className="shrink-0 mb-4 p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-500/50 shadow-xl relative animate-fadeIn">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-mono uppercase text-emerald-400 font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Route Accepted & Synced
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-700">
                {acceptedMission.taskId}
              </span>
              <button
                onClick={() => setAcceptedMission(null)}
                className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 hover:bg-slate-800 rounded transition"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-100 bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
            <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center font-bold font-mono shrink-0">A</span>
            <span className="truncate">{acceptedMission.origin}</span>
            <ArrowRight size={13} className="text-emerald-400 shrink-0 mx-1" />
            <span className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 text-[10px] flex items-center justify-center font-bold font-mono shrink-0">B</span>
            <span className="truncate">{acceptedMission.destination}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-2 flex items-center justify-between pt-1.5 border-t border-emerald-900/40">
            <span>Operational Sector: <b className="text-accent">{acceptedMission.city}</b></span>
            <span className="text-emerald-400 font-mono font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> LIVE ON MAP
            </span>
          </div>
        </div>
      )}

      <div className="space-y-3 flex-1">
        {/* Pickup */}
        <div>
          <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
            <span className="w-5 h-5 rounded-full bg-emerald-500/25 text-emerald-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">A</span>
            Pickup
          </label>
          <Select className="w-full" value={origin} onChange={e => setOrigin(e.target.value)}>
            {Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}
          </Select>
        </div>

        {/* Extra intermediate stops */}
        {extraStops.map((stop, idx) => (
          <div key={idx}>
            <label className="text-xs text-slate-500 flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-amber-500/25 text-amber-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">{idx + 2}</span>
                Stop {idx + 2}
              </span>
              <button onClick={() => removeExtraStop(idx)} className="text-slate-600 hover:text-red-400 text-[10px] transition">✕ Remove</button>
            </label>
            <Select className="w-full" value={stop} onChange={e => updateExtraStop(idx, e.target.value)}>
              {Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}
            </Select>
          </div>
        ))}

        {/* Add stop */}
        <button onClick={addExtraStop} disabled={extraStops.length >= MAX_EXTRA_STOPS}
          className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-dashed border-slate-700 text-slate-500 hover:border-accent/60 hover:text-accent transition disabled:opacity-30 disabled:cursor-not-allowed">
          <span className="text-sm leading-none font-bold">+</span> Add delivery stop {extraStops.length > 0 && <span className="text-slate-600">({extraStops.length}/{MAX_EXTRA_STOPS})</span>}
        </button>

        {/* Destination */}
        <div>
          <label className="text-xs text-slate-500 flex items-center gap-1.5 mb-1">
            <span className="w-5 h-5 rounded-full bg-red-500/25 text-red-400 text-[9px] flex items-center justify-center font-bold flex-shrink-0">{extraStops.length + 2}</span>
            Final destination
          </label>
          <Select className="w-full" value={destination} onChange={e => setDestination(e.target.value)}>
            {Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}
          </Select>
        </div>

        <div><label className="text-xs text-slate-500">Package / delivery note</label><Input className="w-full mt-1" value={packageInfo} onChange={e => setPackageInfo(e.target.value)} placeholder="e.g. 2 cartons · fragile"/></div>
        <div><label className="text-xs text-slate-500">Vehicle preference</label><Select className="w-full mt-1" value={vehicleType} onChange={e => setVehicleType(e.target.value)}><option>delivery</option><option>car</option><option>truck</option><option>two_wheeler</option></Select></div>

        {route && <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-900/50 p-3"><span className="text-slate-500 text-[10px]">STOPS</span><div className="font-semibold mt-1">{allStopLabels.length}</div></div>
          <div className="rounded-xl bg-slate-900/50 p-3"><span className="text-slate-500 text-[10px]">DISTANCE</span><div className="font-semibold mt-1">{totalDistance} km</div></div>
          <div className="rounded-xl bg-slate-900/50 p-3"><span className="text-slate-500 text-[10px]">ETA</span><div className="font-semibold mt-1">{totalEta} min</div></div>
        </div>}

        <div className="text-[10px] text-slate-500">{loading ? 'Updating road route…' : `Route: ${route?.provider || '—'} · ${incidents.length} incidents near ${currentCity}`}</div>

        {tracking ? (
          <div className="p-4 rounded-xl border border-accent/30 bg-accent/5">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-accent"><Navigation size={15}/> Worker UI (Simulated)</div>
            <div className="space-y-1 mb-3">
              {allStopLabels.map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${i === 0 ? 'bg-emerald-500/30 text-emerald-400' : i === allStopLabels.length - 1 ? 'bg-red-500/30 text-red-400' : 'bg-amber-500/30 text-amber-400'}`}>{i + 1}</span>
                  <span className="text-slate-300">{l}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <PrimaryButton onClick={() => updateCitizenStatus('ACCEPTED')} className="!px-1 !py-2 !text-[10px] !bg-slate-800 border !border-slate-700 hover:!border-accent">Accept</PrimaryButton>
              <PrimaryButton onClick={() => updateCitizenStatus('ON_ROUTE')} className="!px-1 !py-2 !text-[10px]">En Route</PrimaryButton>
              <PrimaryButton onClick={() => updateCitizenStatus('DELIVERED')} className="!px-1 !py-2 !text-[10px] !bg-emerald-900 border !border-emerald-700 hover:!bg-emerald-800 text-white">Delivered</PrimaryButton>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-900/50 p-2 rounded-lg"><div className="text-slate-500 text-[10px]">ETA</div><div className="font-semibold text-slate-200">{totalEta} min</div></div>
              <div className="bg-slate-900/50 p-2 rounded-lg"><div className="text-slate-500 text-[10px]">Remaining</div><div className="font-semibold text-slate-200">{totalDistance} km</div></div>
            </div>
            <PrimaryButton onClick={() => alert('SOS Triggered! Distressed location sent to Command Center.')} className="w-full mt-3 !bg-red-500/20 border !border-red-500/50 text-red-400 hover:!bg-red-500/30 font-semibold text-xs flex items-center justify-center gap-2 py-2">
              <AlertTriangle size={14}/> SOS Emergency
            </PrimaryButton>
          </div>
        ) : (
          <button onClick={toggleTracking} className="w-full rounded-xl px-4 py-3 bg-accent text-base-950 font-semibold text-sm">
            Start delivery tracking ({allStopLabels.length} stop{allStopLabels.length !== 1 ? 's' : ''})
          </button>
        )}
      </div>
    </div>

    {/* Full Screen Map - city-specific incidents shown */}
    <div className="flex-1 relative h-full">
      <QRouteMap
        height="100%"
        origin={PRESETS[origin]}
        destination={PRESETS[destination]}
        waypoints={mapWaypoints}
        routeGeometry={route?.geometry || []}
        incidents={incidents.map((i: any) => ({ lat: i.lat, lon: i.lon, label: `${i.type} · ${i.severity}`, type: i.type, severity: i.severity }))}
        focus={focus}
        pitch3d
        fitRoute
      />
      <div className="absolute top-4 left-4 z-10 glass-strong rounded-xl px-3 py-2 text-[10px] text-slate-300 pointer-events-none">
        {tracking ? '● LIVE DELIVERY' : '● ROUTE PREVIEW'} · road-level map
      </div>
      <div className="absolute bottom-4 left-4 z-10 glass-strong rounded-xl px-3 py-2 text-[9px] text-slate-400 flex flex-wrap gap-3">
        <span><b className="text-emerald-400">A</b> Pickup</span>
        {extraStops.map((_, i) => <span key={i}><b className="text-amber-400">{i + 2}</b> Stop {i + 2}</span>)}
        <span><b className="text-red-400">{allStopLabels.length}</b> Destination</span>
        <span><b className="text-red-400">⚠</b> Incident</span>
      </div>
    </div>
  </div>
}

const DISPATCH_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#f97316','#84cc16','#e11d48',
  '#14b8a6','#a855f7','#eab308','#64748b',
];

function AdminDashboard() {
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const { fleetOptimizationResult, selectedVehicles } = useOptimizationStore()
  const [selectedId, setSelectedId] = useState('Q-01')
  const [currentCity, setCurrentCity] = useState(() => localStorage.getItem('quantara_city') || 'Pune')
  const [incident, setIncident] = useState(false)
  const [stopCount, setStopCount] = useState(6)
  const [mapFocus, setMapFocus] = useState<{ lat:number; lon:number; zoom?:number } | null>(null)
  const [routeOverride, setRouteOverride] = useState<any[]>([])
  const { lastEvent, connected } = useSocket('fleet')
  const { data: traffic } = useQuery({ queryKey: ['traffic-dash'], queryFn: async () => (await api.get('/traffic')).data, refetchInterval: 10000 })
  const { data: fleetData, refetch: refetchFleet } = useQuery({ queryKey: ['fleet-live'], queryFn: async () => (await api.get('/fleet')).data, refetchInterval: 5000 })
  const { data: history } = useQuery({ queryKey: ['history-dash'], queryFn: async () => (await api.get('/routes/history')).data })
  const cityData = MULTI_CITY_STOPS[currentCity]?.[0] || { lat: 18.5204, lon: 73.8567 }
  const { data: incidents } = useQuery({ queryKey: ['dash-incidents', currentCity], queryFn: async () => (await api.get(`/traffic/incidents?lat=${cityData.lat}&lon=${cityData.lon}`)).data, refetchInterval: 15000 })
  const { data: weather } = useQuery({ queryKey: ['dash-weather', currentCity], queryFn: async () => (await api.get(`/weather?lat=${cityData.lat}&lon=${cityData.lon}`)).data, refetchInterval: 60000 })
  const { data: notifications } = useQuery({ queryKey: ['notifications'], queryFn: async () => (await api.get('/notifications')).data, refetchInterval: 15000 })
  const [showNotifications, setShowNotifications] = useState(false);
  const [dispatchPriority, setDispatchPriority] = useState('HIGH');
  const [dispatchCargo, setDispatchCargo] = useState('Emergency Route Clearance / Delivery');

  // Build multiRoutes from the latest VRP optimization result (from AssignTask store)
  const dashboardMultiRoutes = useMemo(() => {
    if (!fleetOptimizationResult?.routes) return [];
    return fleetOptimizationResult.routes.map((r: any, i: number) => ({
      vehicleId: r.vehicleId,
      geometry: r.geometry || [],
      color: DISPATCH_COLORS[i % DISPATCH_COLORS.length],
    }));
  }, [fleetOptimizationResult]);

  const dispatchedVehicleCount = fleetOptimizationResult?.routes?.length ?? 0;
  const totalRouteCount = dashboardMultiRoutes.length;
  const queryClient = useQueryClient();

  const startMission = useMutation({
    mutationFn: async () => {
      const stops = (MULTI_CITY_STOPS[currentCity] || MULTI_CITY_STOPS['Pune']).slice(0, stopCount).map((s) => ({ label: s.label, lat: s.lat, lon: s.lon }))
      return (await api.post(`/fleet/${selectedId}/mission`, { 
        stops, priority: dispatchPriority, title: dispatchCargo, assignedUser: selectedId === 'Q-CITIZEN' ? 'Citizen-01' : selectedId === 'ALL' ? 'Broadcast' : selectedId 
      })).data
    },
    onSuccess: () => { refetchFleet(); alert('Task dispatched successfully!'); },
    onError: (e: any) => { alert(e?.response?.data?.message || 'Dispatch failed'); }
  })
  const cancelMission = useMutation({
    mutationFn: async () => (await api.post(`/fleet/${selectedId}/mission/cancel`)).data,
    onSuccess: () => { refetchFleet(); alert('Task cancelled.'); },
    onError: (e: any) => { alert('Failed to cancel task.'); }
  })

  React.useEffect(() => { if (lastEvent?.event === 'fleet_update' || lastEvent?.event === 'mission_update') refetchFleet() }, [lastEvent, refetchFleet])
  React.useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.type === 'FOCUS_VEHICLE' && d.vehicleId) { const v = (fleetData?.vehicles || []).find((x:any)=>x.id===d.vehicleId); if (v) { setSelectedId(v.id); setRouteOverride([]); setMapFocus({lat:v.lat,lon:v.lon,zoom:16.5}); } }
      if (d.type === 'SHOW_REROUTE' && d.vehicleId && d.geometry) { const v = (fleetData?.vehicles || []).find((x:any)=>x.id===d.vehicleId); if (v) { setSelectedId(v.id); setRouteOverride(d.geometry); setMapFocus({lat:v.lat,lon:v.lon,zoom:16.5}); } }
      if (d.city) setCurrentCity(d.city);
    };
    window.addEventListener('quantara:friday-action', handler);
    window.addEventListener('quantara:city-change', handler);
    return () => {
      window.removeEventListener('quantara:friday-action', handler);
      window.removeEventListener('quantara:city-change', handler);
    };
  }, [fleetData])

  React.useEffect(() => {
    const override = location.state?.routeOverride;
    if (override) {
      if (override.city && override.city !== currentCity) {
        setCurrentCity(override.city);
        localStorage.setItem('quantara_city', override.city);
        window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: override.city } }));
      }
      if (override.originCoords && override.destCoords) {
        setRouteOverride([override.originCoords, override.destCoords]);
        setMapFocus({
          lat: (override.originCoords.lat + override.destCoords.lat) / 2,
          lon: (override.originCoords.lon + override.destCoords.lon) / 2,
          zoom: 13.5
        });
      }
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const vehicles: FleetVehicle[] = useMemo(() => {
    let raw = (fleetData?.vehicles || []).map((v:any) => ({
      id: v.id, lat: v.lat, lon: v.lon, speed: v.speed, status: v.status, eta: v.eta, deliveries: v.deliveries, heading: v.heading,
    }));
    // Only keep active/dispatched vehicles in the fleet view
    raw = raw.filter((v: any) => v.status !== 'IDLE' || v.id === 'Q-CITIZEN');
    if (!raw.some((v:any) => v.id === 'Q-CITIZEN')) {
      raw.unshift({ id: 'Q-CITIZEN', lat: 18.5204, lon: 73.8567, speed: 0, status: 'IDLE', eta: '--', deliveries: 0, heading: 0 });
    }
    return raw;
  }, [fleetData])
  const selected = (fleetData?.vehicles || []).find((v:any) => v.id === selectedId) || vehicles.find(v => v.id === selectedId) || vehicles[0]
  const routeGeometry = routeOverride.length ? routeOverride : (selected?.routeGeometry || [])
  const activeIncidents = (incidents?.incidents || []).length + (incident ? 1 : 0)
  const delayed = vehicles.filter((v:any) => v.status === 'DELAYED').length
  const activeFleetCount = vehicles.filter(v => v.id !== 'Q-CITIZEN' || v.status !== 'IDLE').length
  const avgSpeed = activeFleetCount ? Math.round((vehicles.reduce((a:number,v:any)=>a+(v.status !== 'IDLE' ? v.speed : 0),0)/activeFleetCount)*10)/10 : 0
  const completed = vehicles.reduce((a:number,v:any)=>a+(v.completedDeliveries||0),0)

  const focusVehicle = (v:any) => { setSelectedId(v.id); setRouteOverride([]); setMapFocus({ lat:v.lat, lon:v.lon, zoom:16.5 }) }

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-accent"><Sparkles size={13}/> Intelligent Transportation Command Center</div>
          <h1 className="font-display text-2xl lg:text-3xl font-semibold mt-1">{user?.name?.split(' ')[0]}, fleet is live.</h1>
          <p className="text-slate-500 text-sm mt-1">Road-level vehicle tracking · adaptive routing · QPSO decision engine · {currentCity} operations</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center bg-slate-900/80 rounded-xl p-1 border border-slate-700/80 shadow-sm">
            <Select value={stopCount} onChange={e=>setStopCount(Number(e.target.value))} className="text-xs py-1.5 px-2 border-none bg-transparent">
              {[2,3,6,10,15].map(n=><option key={n} value={n}>{n} stops</option>)}
            </Select>
            <PrimaryButton onClick={() => startMission.mutate()} disabled={startMission.isPending} className="text-xs py-1.5 px-3 flex items-center gap-1.5">
              <Zap size={13}/> Assign task
            </PrimaryButton>
          </div>
          <div className="relative">
            <button onClick={() => setShowNotifications(!showNotifications)} className="p-2 rounded-full bg-slate-800 border border-slate-700 hover:bg-slate-700 relative">
              <Bell size={14} className="text-slate-300" />
              {(notifications?.notifications?.length || 0) > 0 && <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>}
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-10 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3 z-50">
                <div className="text-xs font-semibold mb-2">Notifications</div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                   {(notifications?.notifications || []).length === 0 ? <div className="text-xs text-slate-500">No new notifications</div> : 
                    notifications?.notifications?.map((n:any, i:number) => <div key={i} className="text-[10px] p-2 bg-slate-800 rounded">{n.message || n.text || 'System alert'}</div>)
                   }
                </div>
              </div>
            )}
          </div>
          <GhostButton onClick={() => setIncident(v=>!v)} className="flex items-center gap-2"><AlertTriangle size={14}/> {incident ? 'Clear incident' : 'Simulate incident'}</GhostButton>
        </div>
      </div>


      <div className="grid grid-cols-2 lg:grid-cols-9 gap-2.5">
        <KpiCard label="Live Vehicles" value={activeFleetCount} icon={<Truck size={15}/>}/>
        <KpiCard label="On Route" value={vehicles.filter((v:any)=>v.status==='ON_ROUTE').length} icon={<Navigation size={15}/>} />
        <KpiCard label="Delayed" value={delayed} accent="saffron" icon={<Clock3 size={15}/>} />
        <KpiCard label="Dispatched" value={dispatchedVehicleCount} accent="quantum" icon={<Zap size={15}/>} />
        <KpiCard label="Active Routes" value={totalRouteCount} accent="accent" icon={<RouteIcon size={15}/>} />
        <KpiCard label="Traffic" value={traffic?.avgCongestionPct ?? 0} suffix="%" accent="quantum" icon={<Radio size={15}/>} />
        <KpiCard label="Avg Speed" value={avgSpeed} suffix=" km/h" icon={<Gauge size={15}/>} />
        <KpiCard label="Weather" value={`${weather?.current?.temperature_2m ?? '--'}°C`} suffix={weather?.current?.rain ? ' · Rain' : ' · Clear'} accent="accent" icon={<CloudRain size={15}/>} />
        <KpiCard label="GPS Stream" value={connected ? 'LIVE' : 'RECONNECT'} accent={connected ? 'accent' : 'saffron'} icon={<Activity size={15}/>} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[235px_minmax(0,1fr)_310px] gap-3">
        <GlassCard className="p-0 overflow-hidden min-h-[680px]">
          <div className="px-4 py-3 border-b border-slate-800/70 flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-widest text-slate-500">Dispatch Queue</div><div className="text-sm font-semibold mt-1">{activeFleetCount} active units</div></div><Badge tone="green">LIVE</Badge></div>
          <div className="p-2 border-b border-slate-800/60 flex gap-1 text-[9px] text-slate-500"><span className="px-2 py-1 rounded-md bg-slate-800/70 text-slate-200">All</span><span className="px-2 py-1">On route</span><span className="px-2 py-1">Waiting</span><span className="px-2 py-1">Delayed</span></div>
          <div className="divide-y divide-slate-800/60">
            {vehicles.map((v:any) => <button key={v.id} onClick={()=>focusVehicle(v)} className={`w-full text-left p-3 hover:bg-slate-800/50 ${selectedId===v.id ? 'bg-accent/5 border-l-2 border-accent' : ''}`}>
              <div className="flex justify-between items-center"><span className="font-mono text-[11px] text-slate-200">{v.id}</span><Badge tone={v.status==='DELAYED'?'yellow':'green'}>{v.status.replace('_',' ')}</Badge></div>
              <div className="text-[10px] text-slate-500 mt-1 truncate">{v.matchedRoad || 'Online Dispatch Unit'}</div>
              <div className="flex justify-between text-[10px] mt-2"><span>{v.speed} km/h</span><span>{v.eta}</span></div>
              <div className="h-1 mt-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-accent" style={{width:`${Math.min(100,v.routeProgressPct||0)}%`}}/></div>
              <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>{Math.round(v.routeProgressPct||0)}% route</span><span>{v.locationSource || 'live'} · {timeAgo(v.lastGpsAt)}</span></div>
            </button>)}
          </div>
        </GlassCard>

        <GlassCard className="p-0 overflow-hidden min-h-[680px] relative">
          <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between pointer-events-none">
            <div className="flex flex-col gap-2 pointer-events-auto">
              <div className="flex gap-2">
                <div className="glass-strong rounded-xl px-3 py-2 text-[10px] text-slate-300"><span className="inline-block w-2 h-2 rounded-full bg-accent mr-2"/>{currentCity} · road-level live view</div>
                <div className="glass-strong rounded-xl px-3 py-2 text-[10px]">{selected?.mission ? `MISSION · STOP ${Math.min(selected.mission.currentIndex+1, selected.mission.stops.length)}/${selected.mission.stops.length}${selected.mission.active ? '' : ' · COMPLETE'}` : 'FLEET TRACKING'}</div>
              </div>
              <SearchControl onSelect={(lat, lon) => setMapFocus({lat, lon, zoom: 15})} className="w-[300px]" placeholder="Search city, road, landmark..." />
            </div>
            <div className="glass-strong rounded-xl px-3 py-2 text-[9px] text-slate-400 pointer-events-auto">{new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
          </div>
          <QRouteMap height="680px" vehicles={vehicles} routeGeometry={routeGeometry} multiRoutes={dashboardMultiRoutes.length > 0 ? dashboardMultiRoutes : undefined} focus={mapFocus} waypoints={(selected?.mission?.stops || []).map((s:any)=>({label:`${s.label}${s.completed ? ' ✓' : ''}`,lat:s.lat,lon:s.lon}))} incidents={incident ? [{lat:18.5530,lon:73.8070,label:'Simulated road closure', type: 'ROAD_CLOSURE', severity: 'SEVERE'}] : []}/>
          <div className="absolute bottom-3 left-3 z-10 glass-strong rounded-xl px-3 py-2 text-[9px] text-slate-400 flex flex-wrap gap-3 max-w-[60%]">
            <span><b className="text-[#22d3ee]">➤</b> Live vehicle</span>
            <span><b className="text-emerald-400">●</b> Stop/Depot</span>
            <span><b className="text-red-400">⚠</b> Incident</span>
            <span><b className="text-orange-400">➤</b> Delayed</span>
            <span><b className="text-[#ff6b35]">⛔</b> Road Closure</span>
          </div>
          <button onClick={()=> { const c = CITY_CENTERS[currentCity] || CITY_CENTERS['Pune']; setMapFocus({lat:c.lat,lon:c.lon,zoom:13.7}) }} className="absolute right-3 bottom-3 z-10 glass-strong rounded-xl px-3 py-2 text-xs text-slate-300 hover:text-accent flex items-center gap-2"><MapPinned size={13}/> {currentCity} view</button>
        </GlassCard>

        <div className="space-y-3">
          <GlassCard>
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Truck size={15} className="text-accent"/><span className="font-display text-sm">{selected?.id || 'Vehicle'} · live telemetry</span></div><Badge tone={selected?.status==='DELAYED'?'yellow':'green'}>{selected?.status || '—'}</Badge></div>
            {selected && <div className="space-y-3 text-[11px]">
              <div className="rounded-xl bg-slate-950/40 p-3"><div className="text-slate-500">Matched road</div><div className="text-slate-200 mt-1">{selected.matchedRoad}</div><div className="text-[9px] text-slate-600 mt-1">{selected.locationSource} · confidence {selected.confidencePct}%</div></div>
              <div className="grid grid-cols-2 gap-2 min-w-0"><div className="bg-slate-900/50 rounded-xl p-3 min-w-0 overflow-hidden"><span className="text-slate-500">Speed</span><div className="text-lg font-semibold text-accent mt-1 whitespace-nowrap">{selected.speed}<span className="text-[10px]"> km/h</span></div></div><div className="bg-slate-900/50 rounded-xl p-3 min-w-0 overflow-hidden"><span className="text-slate-500">ETA</span><div className="text-sm font-mono font-semibold mt-2 whitespace-nowrap tabular-nums">{selected.eta}</div></div></div>
              <div><div className="flex justify-between text-slate-500"><span>Route progress</span><span>{Math.round(selected.routeProgressPct)}%</span></div><div className="h-2 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className="h-full bg-accent" style={{width:`${selected.routeProgressPct}%`}}/></div></div>
              <div className="grid grid-cols-2 gap-2"><div><span className="text-slate-600">Remaining</span><div className="text-slate-200">{selected.distanceRemainingKm} km</div></div><div><span className="text-slate-600">GPS age</span><div className="text-slate-200">{timeAgo(selected.lastGpsAt)}</div></div></div>
            </div>}
          </GlassCard>

          {selected?.mission && <GlassCard>
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><RouteIcon size={15} className="text-accent"/><h3 className="text-sm font-medium">Mission progress</h3></div><Badge tone={selected.mission.active ? 'green' : 'default'}>{selected.mission.active ? 'IN PROGRESS' : 'COMPLETE'}</Badge></div>
            <div className="text-[11px] text-slate-400 mb-2">
              STOP {Math.min(selected.mission.currentIndex + 1, selected.mission.stops.length)}/{selected.mission.stops.length}
              {selected.mission.active && selected.mission.stops[selected.mission.currentIndex] && <> · current: <b className="text-accent">{selected.mission.stops[selected.mission.currentIndex].label}</b></>}
              {selected.mission.active && selected.mission.stops[selected.mission.currentIndex+1] && <> · next: {selected.mission.stops[selected.mission.currentIndex+1].label}</>}
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {selected.mission.stops.map((s:any, i:number) => (
                <div key={i} className="flex items-center justify-between text-[10px] rounded-lg bg-slate-900/40 px-3 py-1.5">
                  <span className={s.completed ? 'text-slate-500 line-through' : i===selected.mission.currentIndex ? 'text-accent' : 'text-slate-300'}>{i+1}. {s.label}</span>
                  <Badge tone={s.completed ? 'green' : i===selected.mission.currentIndex ? 'yellow' : 'default'}>{s.completed ? 'DONE' : i===selected.mission.currentIndex ? 'ACTIVE' : 'PENDING'}</Badge>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-slate-600 mt-2">Stops advance automatically as the vehicle arrives — no manual map interaction required.</div>
          </GlassCard>}

          <GlassCard>
            <div className="flex items-center gap-2 mb-3"><Package size={15} className="text-quantum"/><h3 className="text-sm font-medium">Load Planning</h3></div>
            <div className="space-y-2">{['Pallet A1-A4','Pallet B2-B5','Pallet C1-C3','Priority P-07'].map((x,i)=><div key={x} className="flex items-center justify-between text-[10px] rounded-lg bg-slate-900/40 px-3 py-2"><span>{x}</span><Badge tone={i===3?'yellow':i===0?'green':'default'}>{i===0?'Loaded':i===3?'Priority':'Assigned'}</Badge></div>)}</div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><RouteIcon size={15} className="text-accent"/><h3 className="text-sm font-medium">Freight Schedule</h3></div><span className="text-[9px] text-slate-600">LIVE WINDOW</span></div>
            <div className="space-y-2 text-[10px]">{[`08:30 · Q-01 · ${(MULTI_CITY_STOPS[currentCity]||MULTI_CITY_STOPS['Pune'])[0]?.label}`,`10:00 · Q-03 · ${(MULTI_CITY_STOPS[currentCity]||MULTI_CITY_STOPS['Pune'])[1]?.label}`,`12:00 · Q-02 · ${(MULTI_CITY_STOPS[currentCity]||MULTI_CITY_STOPS['Pune'])[2]?.label}`].map(x=><div key={x} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent"/><span className="text-slate-300">{x}</span></div>)}</div>
          </GlassCard>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <GlassCard><div className="flex items-center gap-2 mb-3"><Bot size={15} className="text-accent"/><h3 className="text-sm font-medium">FRIDAY live loop</h3></div><div className="flex items-center gap-2 text-[10px] text-slate-400"><span className="text-accent">TRACK</span><ArrowRight size={11}/><span className="text-accent">DETECT</span><ArrowRight size={11}/><span className="text-quantum">QPSO</span><ArrowRight size={11}/><span className="text-emerald-400">RE-ROUTE</span><ArrowRight size={11}/><span>MONITOR</span></div><p className="text-[10px] text-slate-600 mt-3">Live GPS → road matching → ETA → traffic-aware optimization → route update.</p></GlassCard>
        <GlassCard><div className="flex items-center gap-2 mb-3"><ShieldCheck size={15} className="text-emerald-400"/><h3 className="text-sm font-medium">Network intelligence</h3></div><div className="space-y-2 text-[10px]"><div className="flex justify-between"><span className="text-slate-500">Traffic source</span><Badge tone="green">{traffic?.source || 'LIVE / FALLBACK'}</Badge></div><div className="flex justify-between"><span className="text-slate-500">Tracking algorithm</span><span className="text-slate-300">Road-match + ETA</span></div><div className="flex justify-between"><span className="text-slate-500">Map</span><span className="text-slate-300">OpenStreetMap · 3D</span></div></div></GlassCard>
        <GlassCard><div className="flex items-center gap-2 mb-3"><Activity size={15} className="text-quantum"/><h3 className="text-sm font-medium">Mission health</h3></div><div className="grid grid-cols-3 gap-2 text-center"><div><div className="text-lg font-semibold text-accent">{completed}</div><div className="text-[9px] text-slate-600">completed</div></div><div><div className="text-lg font-semibold">{activeIncidents}</div><div className="text-[9px] text-slate-600">incidents</div></div><div><div className="text-lg font-semibold">{history?.routes?.length ?? 0}</div><div className="text-[9px] text-slate-600">saved routes</div></div></div></GlassCard>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const role = useAuthStore((s) => s.user?.role)
  return role === 'citizen' ? <CitizenDelivery /> : <AdminDashboard />
}
