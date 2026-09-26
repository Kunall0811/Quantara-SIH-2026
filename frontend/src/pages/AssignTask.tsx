import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Truck, CheckCircle2 } from 'lucide-react';
import api from '../api/client';
import { Badge, PrimaryButton, GhostButton, Input } from '../components/ui';
import QRouteMap from '../components/QRouteMap';
import { useOptimizationStore } from '../store/optimizationStore';

import { MULTI_CITY_STOPS, CITY_CENTERS } from '../lib/missionResolver';

const COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#e11d48', // rose
  '#14b8a6', // teal
  '#a855f7', // purple
  '#eab308', // yellow
  '#64748b', // slate
];

export default function AssignTask() {
  const { 
    selectedVehicles, setSelectedVehicles, 
    selectedStops, setSelectedStops, 
    fleetOptimizationResult: optimizationResult, setFleetOptimizationResult: setOptimizationResult 
  } = useOptimizationStore();
  
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [stopSearch, setStopSearch] = useState('');
  const [availableVehicles, setAvailableVehicles] = useState<string[]>(['Q-CITIZEN', 'Q-01', 'Q-02', 'Q-03', 'Q-04', 'Q-05', 'Q-06']);

  const handleAddCustomVehicle = () => {
    if (!vehicleSearch) return;
    const cleanId = vehicleSearch.trim().toUpperCase();
    if (!availableVehicles.includes(cleanId)) {
      setAvailableVehicles(prev => [...prev, cleanId]);
    }
    if (!selectedVehicles.includes(cleanId)) {
      setSelectedVehicles([...selectedVehicles, cleanId]);
    }
    setVehicleSearch('');
  };

  const [currentCity, setCurrentCity] = useState(() => localStorage.getItem('quantara_city') || 'Pune');
  const [availableStops, setAvailableStops] = useState(MULTI_CITY_STOPS[currentCity] || MULTI_CITY_STOPS['Pune']);
  const [isAddingStop, setIsAddingStop] = useState(false);

  React.useEffect(() => {
    const valid = MULTI_CITY_STOPS[currentCity];
    if (valid) {
      const filtered = selectedStops.filter(s => valid.some(v => v.label === s));
      if (filtered.length !== selectedStops.length) {
        setSelectedStops(filtered);
      }
    }
  }, [currentCity, selectedStops, setSelectedStops]);

  React.useEffect(() => {
    const handleCityChange = (e: Event) => {
      const city = (e as CustomEvent).detail?.city;
      if (city && MULTI_CITY_STOPS[city]) {
        setCurrentCity(city);
        setAvailableStops(MULTI_CITY_STOPS[city]);
        setSelectedStops([]); // clear selected stops when changing city
        setOptimizationResult(null); // clear previous optimization
      }
    };
    window.addEventListener('quantara:city-change', handleCityChange);
    return () => window.removeEventListener('quantara:city-change', handleCityChange);
  }, []);

  const handleAddCustomStop = async () => {
    if (!stopSearch || availableStops.some(s => s.label.toLowerCase() === stopSearch.toLowerCase())) return;
    setIsAddingStop(true);
    try {
      const res = await api.get(`/maps/geocode?address=${encodeURIComponent(stopSearch)}`);
      if (res.data?.success) {
        const newStop = { label: res.data.displayName.split(',')[0], lat: res.data.lat, lon: res.data.lon };
        setAvailableStops(prev => [...prev, newStop]);
        setSelectedStops([...selectedStops, newStop.label]);
        setStopSearch('');
      } else {
        alert('Could not find that location');
      }
    } catch {
      alert('Error searching for location');
    }
    setIsAddingStop(false);
  };

  const { data: traffic } = useQuery({ queryKey: ['traffic-dash'], queryFn: async () => (await api.get('/traffic')).data, refetchInterval: 10000 });
  const { data: fleetData } = useQuery({ queryKey: ['fleet-live'], queryFn: async () => (await api.get('/fleet')).data, refetchInterval: 5000 });

  const queryClient = useQueryClient();

  const runVrp = useMutation({
    mutationFn: async () => {
      const customers = selectedStops.map(label => {
        const s = availableStops.find(x => x.label === label)!;
        return { lat: s.lat, lon: s.lon, demand: 1 };
      });
      const capacityPerVehicle = Math.ceil(selectedStops.length / selectedVehicles.length) || 1;
      const fleet = selectedVehicles.map((id) => ({ id, capacity: capacityPerVehicle }));
      const depotCity = CITY_CENTERS[currentCity] || CITY_CENTERS['Pune'];
      const result = (await api.post('/optimization/vrp-run', { 
        depot: { lat: depotCity.lat, lon: depotCity.lon },
        customers,
        fleet,
      })).data;

      if (result && result.routes) {
        // Collect all assigned vehicle IDs for the cancellation check
        const assignedIds = new Set<string>();

        await Promise.all(result.routes.map(async (r: any) => {
          if (r.waypoints && r.waypoints.length > 2) {
            assignedIds.add(r.vehicleId);
            // Skip the first and last waypoints since they are the Depot
            const stops = r.waypoints.slice(1, -1).map((ll: any, i: number) => {
               const stopDetails = availableStops.find(s => Math.abs(s.lat - ll.lat) < 0.001 && Math.abs(s.lon - ll.lon) < 0.001);
               return { label: stopDetails?.label || `Delivery ${i+1}`, lat: ll.lat, lon: ll.lon };
            });
            await api.post(`/fleet/${r.vehicleId}/mission`, {
              stops, priority: 'HIGH', title: 'VRP Fleet Dispatch', assignedUser: r.vehicleId
            }).catch(console.error);
          } else {
            await api.post(`/fleet/${r.vehicleId}/mission/cancel`).catch(console.error);
          }
        }));

        // Cancel any existing missions for vehicles not part of this dispatch
        if (fleetData?.vehicles) {
          const unassigned = fleetData.vehicles.filter((v: any) => 
            v.id !== 'Q-CITIZEN' && !assignedIds.has(v.id) && v.status !== 'IDLE'
          );
          await Promise.all(unassigned.map((v: any) => 
            api.post(`/fleet/${v.id}/mission/cancel`).catch(console.error)
          ));
        }
      }

      return result;
    },
    onSuccess: (data) => {
      setOptimizationResult(data);
      queryClient.invalidateQueries({ queryKey: ['fleet-live'] });
    },
  });

  const toggleVehicle = (id: string) => {
    setSelectedVehicles(selectedVehicles.includes(id) ? selectedVehicles.filter((x: string) => x !== id) : [...selectedVehicles, id]);
  };
  const toggleStop = (label: string) => {
    setSelectedStops(selectedStops.includes(label) ? selectedStops.filter((x: string) => x !== label) : [...selectedStops, label]);
  };

  const multiRoutes = useMemo(() =>
    optimizationResult?.routes?.map((r: any, i: number) => ({
      vehicleId: r.vehicleId,
      geometry: r.geometry || [],
      color: COLORS[i % COLORS.length],
    })),
    [optimizationResult]
  );

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden relative">
      <div className="w-full md:w-[450px] flex-shrink-0 bg-base-950/80 backdrop-blur-xl border-r border-slate-800/80 flex flex-col overflow-y-auto z-10 custom-scrollbar">
        <div className="p-6 space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Multi-Vehicle Dispatch</h1>
            <p className="text-slate-500 text-xs mt-1">Fleet routing & QPSO optimization</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Select Vehicles (Fleet)</label>
            <div className="flex gap-2 mb-2">
              <Input placeholder="Search/type vehicle ID..." value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)} className="flex-1 bg-slate-900 border-slate-700" onKeyDown={e => e.key === 'Enter' && vehicleSearch && handleAddCustomVehicle()} />
              <button onClick={handleAddCustomVehicle} disabled={!vehicleSearch} className="px-3 py-2 bg-accent text-base-950 rounded-lg text-xs font-semibold disabled:opacity-50">
                + Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {availableVehicles.filter(id => id.toLowerCase().includes(vehicleSearch.toLowerCase())).map(id => (
                <button key={id} onClick={() => toggleVehicle(id)} className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedVehicles.includes(id) ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                  {id}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] text-slate-500 uppercase font-semibold">Select Destinations (Tasks)</label>
            <div className="flex gap-2 mb-2">
              <Input placeholder="Search/type location..." value={stopSearch} onChange={e => setStopSearch(e.target.value)} className="flex-1 bg-slate-900 border-slate-700" onKeyDown={e => e.key === 'Enter' && stopSearch && handleAddCustomStop()} />
              <button onClick={handleAddCustomStop} disabled={!stopSearch || isAddingStop} className="px-3 py-2 bg-saffron text-base-950 rounded-lg text-xs font-semibold disabled:opacity-50">
                {isAddingStop ? '...' : '+ Add'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto custom-scrollbar">
              {availableStops.filter(stop => stop.label.toLowerCase().includes(stopSearch.toLowerCase())).map(stop => (
                <button key={stop.label} onClick={() => toggleStop(stop.label)} className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${selectedStops.includes(stop.label) ? 'bg-saffron/20 border-saffron/50 text-saffron' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                  {stop.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 p-3 rounded-lg text-xs font-medium">
             <div className="flex gap-4">
                <div><span className="text-slate-500">Vehicles:</span> <span className="text-emerald-400">{selectedVehicles.length}</span></div>
                <div><span className="text-slate-500">Deliveries:</span> <span className="text-saffron">{selectedStops.length}</span></div>
             </div>
             {selectedVehicles.length > 0 && selectedStops.length > 0 && (
                <div className="text-slate-500">Ready to dispatch</div>
             )}
          </div>

          <PrimaryButton onClick={() => runVrp.mutate()} disabled={runVrp.isPending || selectedVehicles.length === 0 || selectedStops.length === 0} className="w-full py-3 flex items-center justify-center gap-2">
            <Zap size={16} /> {runVrp.isPending ? 'Optimizing Routes...' : 'Run Fleet Optimization'}
          </PrimaryButton>

          {optimizationResult && (
            <div className="mt-6 pt-6 border-t border-slate-800">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={16} /> Optimization Complete
              </h3>
              
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase">Total Distance</div>
                  <div className="font-mono font-bold text-lg">{optimizationResult.distanceKm.toFixed(1)} <span className="text-xs font-sans font-normal text-slate-400">km</span></div>
                </div>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
                  <div className="text-[10px] text-slate-500 uppercase">Total Fuel Cost</div>
                  <div className="font-mono font-bold text-lg text-saffron">₹{optimizationResult.fuelCostInr}</div>
                </div>
              </div>

              <div className="space-y-3">
                {optimizationResult.routes.map((r: any, i: number) => (
                  <div key={r.vehicleId} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: COLORS[i % COLORS.length] }}></div>
                    <div className="flex justify-between items-center pl-2">
                      <div className="font-semibold text-sm flex items-center gap-2"><Truck size={14} style={{ color: COLORS[i % COLORS.length] }} /> {r.vehicleId}</div>
                      <Badge tone="default">{r.geometry.length > 2 ? `${r.geometry.length - 2} stops` : 'Idle'}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs pl-2">
                      <div><span className="text-slate-500 block text-[9px]">DISTANCE</span>{r.distanceKm.toFixed(1)} km</div>
                      <div><span className="text-slate-500 block text-[9px]">ETA</span>{r.durationMinutes.toFixed(0)} min</div>
                      <div><span className="text-slate-500 block text-[9px]">LOAD</span>{r.load} pkgs</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 relative bg-slate-950">
        <QRouteMap 
          fitRoute 
          multiRoutes={multiRoutes} 
          vehicles={selectedVehicles.map(id => {
            const live = (fleetData?.vehicles || []).find((v: any) => v.id === id);
            const depot = CITY_CENTERS[currentCity] || CITY_CENTERS['Pune'];
            return live || { id, lat: depot.lat, lon: depot.lon, status: 'IDLE', speed: 0, heading: 0, eta: '', deliveries: 0 };
          })} 
          waypoints={selectedStops.map(label => {
            const s = availableStops.find(x => x.label === label);
            return s ? { label: s.label, lat: s.lat, lon: s.lon } : null;
          }).filter(Boolean) as any[]}
        />
      </div>
    </div>
  );
}
