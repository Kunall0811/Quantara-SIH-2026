import React, { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Cpu, Plus, Trash2, Navigation, CheckCircle2, Play, Square, Radio, CloudRain, AlertTriangle } from 'lucide-react'
import api from '../api/client'
import { GlassCard, PrimaryButton, GhostButton, Input, Select, Badge } from '../components/ui'
import QRouteMap from '../components/QRouteMap'
import PlatformVerification from '../components/PlatformVerification'
import DirectionsPanel from '../components/DirectionsPanel'
import { useSocket } from '../lib/useSocket'
import type { LatLon, OptimizationResponse, RouteCalcResponse, VehicleProfile } from '../lib/types'
import { useOptimizationStore } from '../store/optimizationStore'

const ALGORITHMS=[{value:'QPSO',label:'QPSO — Quantum-Inspired PSO'},{value:'AQPSO',label:'Adaptive QPSO — feedback-controlled β'},{value:'PSO',label:'PSO — Classical'},{value:'GA',label:'Genetic Algorithm'},{value:'SA',label:'Simulated Annealing'},{value:'EXACT',label:'Exact (Small-instance solver)'}]
import { useCityPresets } from '../lib/cities'
const ALGO_ENDPOINT:Record<string,string>={QPSO:'qpso',AQPSO:'adaptive-qpso',PSO:'pso',GA:'genetic',SA:'simulated-annealing',EXACT:'exact'}
const sessionId=`session-${Math.random().toString(36).slice(2)}`
function clampInt(v:string,min:number,max:number){const n=Number.parseInt(v.replace(/\D/g,''),10);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min}
function dist(a:LatLon,b:LatLon){const R=6371,d1=(b.lat-a.lat)*Math.PI/180,d2=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(d1/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(d2/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)))}
function pointAt(geometry:LatLon[],progress:number){if(!geometry.length)return null; if(geometry.length===1)return geometry[0];const lengths=geometry.slice(0,-1).map((p,i)=>dist(p,geometry[i+1]));const total=lengths.reduce((a,b)=>a+b,0);let left=total*Math.max(0,Math.min(.9999,progress));for(let i=0;i<lengths.length;i++){if(left<=lengths[i]){const t=lengths[i]?left/lengths[i]:0;return{lat:geometry[i].lat+(geometry[i+1].lat-geometry[i].lat)*t,lon:geometry[i].lon+(geometry[i+1].lon-geometry[i].lon)*t,label:'Mission vehicle'}}left-=lengths[i]}return geometry[geometry.length-1]!}

export default function PlanOptimize(){
 const [searchParams]=useSearchParams(); const demoMode=searchParams.get('demo')==='20'
 const { city, presets } = useCityPresets()
 const presetKeys = Object.keys(presets)
 const [waypoints,setWaypoints]=useState<LatLon[]>([]);
 const [origin,setOrigin]=useState<LatLon>(presets[presetKeys[0]]), [destination,setDestination]=useState<LatLon>(presets[presetKeys[1]])

 // Update selection if city changes
 React.useEffect(() => {
   setOrigin(presets[Object.keys(presets)[0]])
   setDestination(presets[Object.keys(presets)[1]])
 }, [city, presets])
 const { algorithm, populationSize, maxIterations, setAlgorithm, setPopulationSize, setMaxIterations, currentIteration, totalIterations, setProgress } = useOptimizationStore()
 const [vehicle,setVehicle]=useState<VehicleProfile>({type:'car',maxSpeedKmph:80,fuelEfficiencyKmPerL:15,fuelType:'petrol',capacityKg:500,priority:'normal'})
 const [mission,setMission]=useState(false),[missionStartedAt,setMissionStartedAt]=useState<number|null>(null),[missionNow,setMissionNow]=useState(Date.now())
 const [liveRoute,setLiveRoute]=useState<RouteCalcResponse|null>(null),[routeLoading,setRouteLoading]=useState(false),[routeError,setRouteError]=useState('')
 const {lastEvent}=useSocket(sessionId)

  useEffect(() => {
    if (lastEvent?.event === 'optimization_progress') {
      setProgress(lastEvent.data.iteration, lastEvent.data.total)
    }
  }, [lastEvent, setProgress])


 const points=useMemo(()=>[origin,...waypoints,destination],[origin,waypoints,destination])
 const routePointsKey=JSON.stringify(points.map(p=>[p.lat,p.lon]))

 useEffect(()=>{if(!demoMode)return;const stops=Object.values(presets).slice(0,5);setWaypoints(Array.from({length:20},(_,i)=>({...stops[i%stops.length],label:`Delivery ${i+1}`})));setPopulationSize(24);setMaxIterations(40)},[demoMode, presets])
 const loadRoadRoute=async()=>{setRouteLoading(true);setRouteError('');try{const {data}=await api.post<RouteCalcResponse>('/routes/calculate-through',{points});setLiveRoute(data);return data}catch(e:any){setRouteError(e?.response?.data?.message||'Live road routing failed');return null}finally{setRouteLoading(false)}}
 useEffect(()=>{const t=window.setTimeout(()=>loadRoadRoute(),350);return()=>window.clearTimeout(t)},[routePointsKey])
 useEffect(()=>{if(!mission)return;const t=window.setInterval(()=>setMissionNow(Date.now()),1000);return()=>window.clearInterval(t)},[mission])
 useEffect(()=>{if(!mission)return;const t=window.setInterval(()=>{loadRoadRoute()},15000);return()=>window.clearInterval(t)},[mission,routePointsKey])
 const optimize=useMutation({
   mutationFn:async()=>{const {data}=await api.post<OptimizationResponse>(`/optimization/${ALGO_ENDPOINT[algorithm]}`,{origin,destination,waypoints,vehicle,populationSize,maxIterations,sessionId});return data},
   onSuccess: (data) => {
     if (data.waypointOrder && data.waypointOrder.length === waypoints.length) {
        setWaypoints(w => data.waypointOrder.map((idx: number) => w[idx]));
     }
   }
 })
  const addWaypoint=()=>{
    const cityKeys = Object.keys(presets).filter(k => k.startsWith(city));
    if(cityKeys.length > 0) setWaypoints(w=>[...w,{...presets[cityKeys[0]], label: cityKeys[0]}]);
  }
  const removeWaypoint=(i:number)=>setWaypoints(w=>w.filter((_,idx)=>idx!==i));
  const updateWaypoint=(i:number,key:string)=>setWaypoints(w=>w.map((p,idx)=>idx===i?{...presets[key],label:key}:p))
  const startMission=async()=>{
    const route=liveRoute||await loadRoadRoute();
    if(!route)return;
    setMissionStartedAt(Date.now());
    setMissionNow(Date.now());
    setMission(true);
    api.post('/fleet/Q-CITIZEN/mission', { stops: points.map(p => ({ label: p.label || 'Stop', lat: p.lat, lon: p.lon })) }).catch(console.error);
  }
 const stopMission=()=>setMission(false)
 const missionProgress=mission&&missionStartedAt&&liveRoute?Math.min(.995,(missionNow-missionStartedAt)/Math.max(60000,liveRoute.durationMinutes*60000)):0
 const missionPoint=mission?pointAt(liveRoute?.geometry||[],missionProgress):null
 const result=optimize.data as any
 const [activeStep,setActiveStep]=useState<number|null>(null)
 const mapSteps=(result?.steps||[]).map((st:any)=>({index:st.index,lat:st.location.lat,lon:st.location.lon,maneuver:st.maneuver,instruction:st.instruction}))
 
 const runOptimization = () => {
   setProgress(0, maxIterations)
   optimize.mutate()
 }

 const [showAdvanced, setShowAdvanced] = useState(false);

 useEffect(()=>{const h=(e:Event)=>{const d=(e as CustomEvent).detail||{};if(d.type==='RUN_OPTIMIZATION')runOptimization();if(d.type==='START_MISSION')startMission();if(d.type==='STOP_MISSION')stopMission()};window.addEventListener('quantara:friday-action',h);return()=>window.removeEventListener('quantara:friday-action',h)},[liveRoute,algorithm,populationSize,maxIterations,origin,destination,waypoints,vehicle,setProgress])

 return <div className="space-y-6">
  <div className="flex items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Cpu className="text-accent" size={22}/>Plan & Optimize</h1><p className="text-slate-500 text-sm">Live road geometry + traffic-aware routing + QPSO / Adaptive QPSO / PSO / GA / SA / exact. QPSO is quantum-inspired — it runs on ordinary hardware.</p>{demoMode&&<div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] text-accent">SIH DEMO · 20 STOPS</div>}</div>{optimize.isPending&&<Badge tone="purple">Iteration {currentIteration}/{totalIterations||maxIterations}</Badge>}</div>
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
   <GlassCard className="space-y-4">
    <div><label className="text-xs text-slate-500">Origin</label><Select className="w-full mt-1" value={Object.keys(presets).find(k=>presets[k].lat===origin.lat&&presets[k].lon===origin.lon)||''} onChange={e=>setOrigin(presets[e.target.value])}>{Object.keys(presets).map(k=><option key={k}>{k}</option>)}</Select></div>
    <div><div className="flex items-center justify-between"><label className="text-xs text-slate-500">Stops (waypoints)</label><button onClick={addWaypoint} className="text-accent text-xs flex items-center gap-1"><Plus size={12}/>Add stop</button></div><div className="space-y-2 mt-1">{waypoints.map((w,i)=><div key={i} className="flex gap-2"><Select className="flex-1" value={Object.keys(presets).find(k=>presets[k].lat===w.lat&&presets[k].lon===w.lon)||''} onChange={e=>updateWaypoint(i,e.target.value)}>{Object.keys(presets).map(k=><option key={k}>{k}</option>)}</Select><button onClick={()=>removeWaypoint(i)} className="text-slate-500"><Trash2 size={14}/></button></div>)}</div></div>
    <div><label className="text-xs text-slate-500">Destination</label><Select className="w-full mt-1" value={Object.keys(presets).find(k=>presets[k].lat===destination.lat&&presets[k].lon===destination.lon)||''} onChange={e=>setDestination(presets[e.target.value])}>{Object.keys(presets).map(k=><option key={k}>{k}</option>)}</Select></div>
    <div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-slate-500">Vehicle</label><Select className="w-full mt-1" value={vehicle.type} onChange={e=>setVehicle({...vehicle,type:e.target.value as any})}>{['car','truck','ambulance','delivery','bus','two_wheeler'].map(t=><option key={t}>{t}</option>)}</Select></div><div><label className="text-xs text-slate-500">Priority</label><Select className="w-full mt-1" value={vehicle.priority} onChange={e=>setVehicle({...vehicle,priority:e.target.value as any})}><option>normal</option><option>high</option><option>emergency</option></Select></div><div><label className="text-xs text-slate-500">Fuel type</label><Select className="w-full mt-1" value={vehicle.fuelType} onChange={e=>setVehicle({...vehicle,fuelType:e.target.value as any})}>{['petrol','diesel','electric','cng'].map(t=><option key={t}>{t}</option>)}</Select></div><div><label className="text-xs text-slate-500">Efficiency</label><Input type="number" min={1} className="w-full mt-1" value={vehicle.fuelEfficiencyKmPerL} onChange={e=>setVehicle({...vehicle,fuelEfficiencyKmPerL:Math.max(1,Number(e.target.value)||1)})}/></div></div>
    <div><label className="text-xs text-slate-500">Algorithm</label><Select className="w-full mt-1" value={algorithm} onChange={e=>setAlgorithm(e.target.value)}>{ALGORITHMS.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</Select></div>
    <div className="grid grid-cols-2 gap-2"><div><label className="text-xs text-slate-500">Population</label><Input type="number" min={4} max={200} inputMode="numeric" className="w-full mt-1" value={populationSize} onChange={e=>setPopulationSize(clampInt(e.target.value,4,200))}/></div><div><label className="text-xs text-slate-500">Iterations</label><Input type="number" min={1} max={1000} inputMode="numeric" className="w-full mt-1" value={maxIterations} onChange={e=>setMaxIterations(clampInt(e.target.value,1,1000))}/></div></div>
    <div className="grid grid-cols-2 gap-2"><PrimaryButton onClick={startMission} disabled={routeLoading||!liveRoute||mission} className="flex items-center justify-center gap-2"><Play size={14}/>{mission?'Mission running':'Start mission'}</PrimaryButton><GhostButton onClick={stopMission} disabled={!mission} className="flex items-center justify-center gap-2"><Square size={13}/>Stop</GhostButton></div>
    <PrimaryButton onClick={runOptimization} disabled={optimize.isPending} className="w-full flex items-center justify-center gap-2"><Navigation size={14}/>{optimize.isPending?'Optimizing…':`Run ${algorithm}`}</PrimaryButton>
    {routeLoading&&<div className="text-[10px] text-accent flex items-center gap-2"><Radio size={12}/>Fetching real road geometry…</div>}{routeError&&<div className="text-red-400 text-xs">{routeError}</div>}{optimize.isError&&<div className="text-red-400 text-xs">{(optimize.error as any)?.response?.data?.message||'Optimization failed'}</div>}
   </GlassCard>
   <GlassCard className="lg:col-span-2 p-0 overflow-hidden h-[560px] relative"><QRouteMap height="100%" origin={origin} destination={destination} waypoints={waypoints} routeGeometry={result?.geometry?.length?result.geometry:liveRoute?.geometry||[]} vehicles={missionPoint?[{id:'MISSION-01',lat:missionPoint.lat,lon:missionPoint.lon,speed:52,status:'ON_ROUTE',eta:liveRoute?`${Math.max(0,Math.ceil(liveRoute.durationMinutes*(1-missionProgress)))} min`:'—',deliveries:waypoints.length,heading:0}]:[]} steps={mapSteps} activeStep={activeStep} fitRoute={!mission}/><div className="absolute top-3 left-3 z-10 glass-strong rounded-xl px-3 py-2 text-[10px] flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent"/>{liveRoute?.provider?.toUpperCase()||'ROAD ROUTE'} · {liveRoute?`${liveRoute.distanceKm} km · ${Math.round(liveRoute.durationMinutes)} min`:'calculating…'}</div>{mission&&<div className="absolute bottom-3 left-3 z-10 glass-strong rounded-xl px-3 py-2 text-[10px] text-emerald-300">● LIVE MISSION · auto-rerouting every 15s · {Math.round(missionProgress*100)}%</div>}</GlassCard>
  </div>
  
  <div className="flex justify-center my-4">
    <button onClick={() => setShowAdvanced(!showAdvanced)} className="px-6 py-2 rounded-full border border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-xs font-semibold text-slate-300 tracking-wider uppercase transition">
      {showAdvanced ? 'Hide Advanced Configuration' : 'Platform Verification & Quick Stops'}
    </button>
  </div>

  {showAdvanced && (
    <GlassCard className="border-accent/40 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
      <PlatformVerification />
      <div className="mt-4 text-[10px] uppercase tracking-wider text-slate-500">Quick-add stops</div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {Object.keys(presets).filter(k=>presets[k].lat!==origin.lat&&presets[k].lat!==destination.lat).map((k)=>{
          const p=presets[k], active=waypoints.some(w=>w.lat===p.lat)
          return <button key={k} onClick={()=>{if(active)setWaypoints(ws=>ws.filter(w=>w.lat!==p.lat));else setWaypoints(ws=>[...ws,{...p,label:k}])}} className={`text-xs px-2 py-1.5 rounded border text-left truncate transition-colors ${active?'bg-accent/10 border-accent/40 text-accent':'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>{k.split(' — ')[1]}</button>
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-end gap-3">
        <GhostButton onClick={() => window.open('/benchmarking', '_blank')} className="text-xs py-1.5">Launch Benchmarking Suite</GhostButton>
        <PrimaryButton onClick={() => window.open('/scalability', '_blank')} className="text-xs py-1.5">View Scalability Metrics</PrimaryButton>
      </div>
    </GlassCard>
  )}

  {liveRoute&&<GlassCard><div className="grid grid-cols-2 md:grid-cols-5 gap-3"><div><div className="text-[10px] text-slate-500">ROUTING</div><div className="font-semibold text-accent">{liveRoute.provider}</div></div><div><div className="text-[10px] text-slate-500">DISTANCE</div><div className="font-semibold">{liveRoute.distanceKm} km</div></div><div><div className="text-[10px] text-slate-500">ETA</div><div className="font-semibold">{Math.round(liveRoute.durationMinutes)} min</div></div><div><div className="text-[10px] text-slate-500">TRAFFIC DELAY</div><div className="font-semibold">{Math.round(liveRoute.trafficDelayMinutes)} min</div></div><div><div className="text-[10px] text-slate-500">CONDITION</div><Badge tone={liveRoute.trafficLevel==='LOW'?'green':liveRoute.trafficLevel==='MODERATE'?'yellow':'red'}>{liveRoute.trafficLevel}</Badge></div></div></GlassCard>}
  {result&&<><div className="grid grid-cols-2 md:grid-cols-5 gap-4"><GlassCard><div className="text-xs text-slate-500 uppercase">Fitness</div><div className="text-2xl kpi-value text-accent">{result.bestFitness.toFixed(1)}</div></GlassCard><GlassCard><div className="text-xs text-slate-500 uppercase">Distance</div><div className="text-2xl kpi-value text-quantum">{result.distanceKm} km</div></GlassCard><GlassCard><div className="text-xs text-slate-500 uppercase">Duration</div><div className="text-2xl kpi-value">{Math.round(result.durationMinutes)} min</div></GlassCard><GlassCard><div className="text-xs text-slate-500 uppercase">Fuel Cost</div><div className="text-2xl kpi-value text-accent">₹{result.fuelCostInr}</div></GlassCard><GlassCard><div className="text-xs text-slate-500 uppercase">CO₂</div><div className="text-2xl kpi-value text-quantum">{result.co2Kg} kg</div></GlassCard></div><GlassCard><h3 className="text-sm font-medium text-slate-300 mb-3">Convergence — Fitness vs Iteration</h3><ResponsiveContainer width="100%" height={240}><LineChart data={result.convergence.map((v,i)=>({iteration:i+1,fitness:v}))}><CartesianGrid strokeDasharray="3 3" stroke="#1c2942"/><XAxis dataKey="iteration" stroke="#64748b" fontSize={11}/><YAxis stroke="#64748b" fontSize={11}/><Tooltip/><Line type="monotone" dataKey="fitness" stroke="#22d3ee" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></GlassCard>{result.steps?.length>0&&<GlassCard><div className="flex items-center gap-2 mb-3"><Navigation size={16} className="text-accent"/><h3 className="text-sm font-medium text-slate-300">Turn-by-turn directions</h3><Badge tone={result.geometrySource==='LIVE'?'green':'default'}>{result.geometrySource==='LIVE'?'LIVE road geometry':'FALLBACK graph geometry'}</Badge><span className="text-[10px] text-slate-500">derived from the path the optimizer evaluated</span></div><DirectionsPanel routes={[{vehicleId:'ROUTE',steps:result.steps,distanceKm:result.distanceKm,totalTimeMin:result.durationMinutes,stops:waypoints.map((w,i)=>({deliveryId:`S${i+1}`}))} as any]} vehicleId="ROUTE" onVehicle={()=>{}} activeStep={activeStep} onStep={setActiveStep}/></GlassCard>}<GlassCard><div className="flex items-center gap-2 mb-3"><CheckCircle2 size={16} className="text-emerald-400"/><h3 className="text-sm font-medium text-slate-300">Why this route</h3></div><ul className="text-xs text-slate-400 space-y-1.5">{result.explanation.map((e,i)=><li key={i}>› {e}</li>)}</ul></GlassCard></>}
 </div>
}
