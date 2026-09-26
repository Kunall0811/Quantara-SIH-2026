import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Play, RefreshCw, Zap, Truck, Send, RotateCcw, Siren, CloudRain, TrafficCone, Ban, Wrench } from 'lucide-react'
import QRouteMap from '../components/QRouteMap'
import DirectionsPanel from '../components/DirectionsPanel'
import ConvergenceChart from '../components/ConvergenceChart'
import { GlassCard, PrimaryButton, GhostButton, Select, Input, Badge, SourceBadge, Stat, ErrorNote, EmptyState, PageHeader } from '../components/ui'
import AnalysisTab from '../components/AnalysisPanels'
import { twinApi, colorFor, fmtMin, f1, errMsg, Plan, TwinState } from '../lib/twin'
import { useSocket } from '../lib/useSocket'

const EVENT_TYPES = [
  { v: 'ACCIDENT', label: 'Accident', icon: Siren }, { v: 'ROAD_CLOSURE', label: 'Road closure', icon: Ban }, { v: 'TRAFFIC_INCREASE', label: 'Traffic increase', icon: TrafficCone },
  { v: 'VEHICLE_BREAKDOWN', label: 'Vehicle breakdown', icon: Wrench }, { v: 'VEHICLE_UNAVAILABLE', label: 'Vehicle unavailable', icon: Truck }, { v: 'WEATHER_CHANGE', label: 'Weather change', icon: CloudRain },
]
const ALGOS = ['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT']
type Tab = 'directions' | 'events' | 'fleet' | 'analysis' | 'replan'

export default function DigitalTwin() {
  const qc = useQueryClient()
  useSocket()
  const [tab, setTab] = useState<Tab>('directions')
  const [algo, setAlgo] = useState('QPSO')
  const [cfg, setCfg] = useState({ customers: 10, vehicles: 4, seed: 42 })
  const [evt, setEvt] = useState<any>({ type: 'ACCIDENT', road: '', vehicleId: '', percent: 30, condition: 'Heavy Rain' })
  const [vehicleId, setVehicleId] = useState('')
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replan, setReplan] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>({})

  const { data: state, isLoading } = useQuery({ queryKey: ['twin'], queryFn: twinApi.state, refetchInterval: 15000 })
  const { data: roads } = useQuery({ queryKey: ['twin-roads', state?.currentPlanId, state?.version], queryFn: () => twinApi.roads(true), enabled: !!state?.loaded })
  const refresh = () => qc.invalidateQueries({ queryKey: ['twin'] })
  useEffect(() => { const h = (e: Event) => { if ((e as CustomEvent).detail?.type === 'REFRESH_TWIN') qc.invalidateQueries({ queryKey: ['twin'] }) }; window.addEventListener('quantara:friday-action', h); return () => window.removeEventListener('quantara:friday-action', h) }, [qc])
  const wrap = <T,>(fn: () => Promise<T>, then?: (r: T) => void) => async () => { setError(null); try { const r = await fn(); then?.(r); await refresh() } catch (e) { setError(errMsg(e)) } }

  const load = useMutation({ mutationFn: () => twinApi.load(cfg), onSuccess: () => { setReplan(null); setAnalysis({}); refresh() }, onError: (e) => setError(errMsg(e)) })
  const optimize = useMutation({ mutationFn: () => twinApi.optimize({ algorithm: algo, maxIterations: 100 }), onSuccess: () => { setReplan(null); refresh() }, onError: (e) => setError(errMsg(e)) })
  const apply = useMutation({
    mutationFn: (reopt: boolean) => twinApi.event({ ...clean(evt), reoptimize: reopt, algorithm: 'AQPSO' }),
    onSuccess: (r) => { setReplan(r.reoptimization ? { ...r.reoptimization, impact: r.impact } : { impact: r.impact, event: r.event }); setTab('replan'); refresh() }, onError: (e) => setError(errMsg(e)),
  })
  const reopt = useMutation({ mutationFn: (mode: 'MINIMAL' | 'FULL') => twinApi.reoptimize({ algorithm: 'AQPSO', mode }), onSuccess: (r) => { setReplan(r); setTab('replan'); refresh() }, onError: (e) => setError(errMsg(e)) })
  const reset = useMutation({ mutationFn: twinApi.resetEvents, onSuccess: () => { setReplan(null); refresh() }, onError: (e) => setError(errMsg(e)) })
  const dispatch = useMutation({ mutationFn: twinApi.dispatch, onSuccess: (r) => setError(r.failed?.length ? `Dispatched ${r.started.length}; failed: ${r.failed.join(', ')}` : null), onError: (e) => setError(errMsg(e)) })
  const execute = useMutation({ mutationFn: twinApi.execute, onSuccess: (r) => setAnalysis((a: any) => ({ ...a, execution: r })), onError: (e) => setError(errMsg(e)) })

  const plan: Plan | null = state?.plan ?? null
  const vids = plan?.routes.map(r => r.vehicleId) ?? []
  const activeVehicle = vehicleId || vids[0] || ''
  const route = plan?.routes.find(r => r.vehicleId === activeVehicle)

  const multiRoutes = useMemo(() => (plan?.routes ?? []).map(r => ({ vehicleId: r.vehicleId, geometry: r.geometry, color: colorFor(r.vehicleId, vids) })), [plan])
  const waypoints = useMemo(() => (state?.deliveries ?? []).map(d => ({ lat: d.lat, lon: d.lon, label: `${d.id} · ${d.label} · ${d.priority} · ${fmtMin(d.windowStart)}–${fmtMin(d.windowEnd)}` })), [state?.deliveries])
  const incidents = useMemo(() => (state?.events ?? []).filter((e: any) => e.location).map((e: any) => ({ lat: e.location.lat, lon: e.location.lon, label: e.description, type: e.request.type, severity: 'HIGH' })), [state?.events])
  const steps = useMemo(() => (route?.steps ?? []).filter(s => s.maneuver !== 'stop' || true).map(s => ({ index: s.index, lat: s.location.lat, lon: s.location.lon, maneuver: s.maneuver, instruction: s.instruction, color: colorFor(route!.vehicleId, vids) })), [route])

  const runAnalysis = (key: string, fn: () => Promise<any>) => async () => { setError(null); setAnalysis((a: any) => ({ ...a, [key]: { loading: true } })); try { const r = await fn(); setAnalysis((a: any) => ({ ...a, [key]: r })) } catch (e) { setError(errMsg(e)); setAnalysis((a: any) => ({ ...a, [key]: undefined })) } }

  if (isLoading) return <div className="text-sm text-slate-400">Loading digital twin…</div>
  const busy = load.isPending || optimize.isPending || apply.isPending || reopt.isPending

  return (
    <div className="space-y-4">
      <PageHeader title="Digital Twin" subtitle="One live state — road graph, fleet, deliveries, weather — that every optimization, incident and analysis runs on. Traffic here is SIMULATED; route geometry is labelled LIVE or FALLBACK per route."
        right={<div className="flex items-center gap-2 flex-wrap"><Badge tone="purple">v{state?.version ?? 0}</Badge><SourceBadge source="SIMULATED" /><Badge>{state?.network.weather ?? '—'}</Badge></div>} />
      <ErrorNote error={error} />

      <GlassCard className="!p-3 flex flex-wrap items-end gap-3">
        {(['customers', 'vehicles', 'seed'] as const).map(k => (
          <label key={k} className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">{k}
            <Input type="number" value={cfg[k]} min={1} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} className="w-24" aria-label={k} />
          </label>
        ))}
        <GhostButton onClick={() => load.mutate()} disabled={busy}><RefreshCw size={14} className="inline mr-1" />{state?.loaded ? 'Reload twin' : 'Load twin'}</GhostButton>
        <span className="hidden md:block w-px h-8 bg-slate-800" />
        <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Algorithm
          <Select value={algo} onChange={e => setAlgo(e.target.value)} aria-label="algorithm">{ALGOS.map(a => <option key={a}>{a}</option>)}</Select>
        </label>
        <PrimaryButton onClick={() => optimize.mutate()} disabled={busy || !state?.loaded}><Play size={14} className="inline mr-1" />{optimize.isPending ? 'Optimizing…' : 'Optimize'}</PrimaryButton>
        <GhostButton onClick={() => dispatch.mutate()} disabled={!plan || dispatch.isPending}><Send size={14} className="inline mr-1" />Dispatch to fleet</GhostButton>
        <GhostButton onClick={() => execute.mutate()} disabled={!plan || execute.isPending}><Zap size={14} className="inline mr-1" />Simulate execution</GhostButton>
      </GlassCard>

      <div className="grid xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)] gap-4">
        <GlassCard className="!p-0 overflow-hidden h-[640px] relative">
          <QRouteMap height="100%" multiRoutes={multiRoutes} waypoints={waypoints} incidents={incidents} steps={steps} activeStep={activeStep} fitRoute />
          <div className="absolute top-3 left-3 z-10 glass-strong rounded-xl px-3 py-2 text-[10px] flex items-center gap-2"><Boxes size={12} className="text-accent" />{state?.label}</div>
          {!plan && <div className="absolute inset-x-0 bottom-6 flex justify-center"><div className="glass-strong rounded-xl px-4 py-2 text-xs text-slate-300">No plan yet — press Optimize</div></div>}
        </GlassCard>

        <GlassCard className="flex flex-col min-h-0 h-[640px]">
          <div role="tablist" className="flex gap-1 mb-3 flex-wrap">
            {([['directions', 'Directions'], ['events', 'Events'], ['replan', 'Re-plan'], ['fleet', 'Fleet'], ['analysis', 'Analysis']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`text-xs px-3 py-1.5 rounded-lg border transition ${tab === k ? 'bg-accent/10 border-accent/30 text-accent' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{l}</button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {tab === 'directions' && (plan ? <DirectionsPanel routes={plan.routes} vehicleId={activeVehicle} onVehicle={setVehicleId} activeStep={activeStep} onStep={setActiveStep} /> : <EmptyState title="No plan yet" hint="Optimize the twin to get routes and turn-by-turn directions." />)}

            {tab === 'events' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {EVENT_TYPES.map(t => <button key={t.v} onClick={() => setEvt({ ...evt, type: t.v })} className={`rounded-xl border px-2 py-2 text-[11px] flex flex-col items-center gap-1 transition ${evt.type === t.v ? 'border-saffron/60 bg-saffron/10 text-saffron' : 'border-slate-700 text-slate-300 hover:bg-slate-800/50'}`}><t.icon size={15} />{t.label}</button>)}
                </div>
                {(evt.type === 'ACCIDENT' || evt.type === 'ROAD_CLOSURE' || evt.type === 'TRAFFIC_INCREASE') && (
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Road {evt.type === 'TRAFFIC_INCREASE' ? '(blank = whole network)' : '(blank = plan’s busiest road)'}
                    <Select value={evt.road} onChange={e => setEvt({ ...evt, road: e.target.value })} aria-label="road"><option value="">{evt.type === 'TRAFFIC_INCREASE' ? 'Whole network' : 'Busiest road on the plan'}</option>{roads?.map(r => <option key={r.id} value={r.code}>{r.code} · {r.name}{r.usedByPlan ? ` · used ×${r.usedByPlan}` : ''}{r.closed ? ' · CLOSED' : ''}</option>)}</Select>
                  </label>
                )}
                {evt.type === 'TRAFFIC_INCREASE' && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Travel-time increase (%)<Input type="number" min={1} max={500} value={evt.percent} onChange={e => setEvt({ ...evt, percent: Number(e.target.value) })} /></label>}
                {(evt.type === 'VEHICLE_BREAKDOWN' || evt.type === 'VEHICLE_UNAVAILABLE') && (
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Vehicle<Select value={evt.vehicleId} onChange={e => setEvt({ ...evt, vehicleId: e.target.value })} aria-label="vehicle"><option value="">Busiest vehicle on the plan</option>{state?.fleet.filter(v => v.available).map(v => <option key={v.id} value={v.id}>{v.id} · {v.name}</option>)}</Select></label>
                )}
                {evt.type === 'WEATHER_CHANGE' && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Condition<Select value={evt.condition} onChange={e => setEvt({ ...evt, condition: e.target.value })}>{['Clear Sky', 'Light Rain', 'Heavy Rain', 'Dense Fog', 'Storm'].map(c => <option key={c}>{c}</option>)}</Select></label>}
                <div className="flex gap-2 flex-wrap">
                  <GhostButton onClick={() => apply.mutate(false)} disabled={busy || !state?.loaded}>Apply to twin</GhostButton>
                  <PrimaryButton onClick={() => apply.mutate(true)} disabled={busy || !plan}>Apply + re-optimize</PrimaryButton>
                  <GhostButton onClick={() => reset.mutate()} disabled={!state?.events.length}><RotateCcw size={13} className="inline mr-1" />Clear events</GhostButton>
                </div>
                <div className="text-[11px] text-slate-500">Applying mutates the live twin; “Advanced Decision Lab” previews the same events on a clone without touching it.</div>
                <div className="space-y-1.5">{(state?.events ?? []).slice().reverse().map(e => <div key={e.id} className="rounded-lg bg-slate-900/50 border border-slate-800 px-3 py-2 text-xs"><span className="text-saffron font-mono mr-2">{e.id}</span>{e.description}</div>)}{!state?.events.length && <div className="text-xs text-slate-500">No events applied.</div>}</div>
              </div>
            )}

            {tab === 'replan' && (replan ? <ReplanView r={replan} /> : (
              <div className="space-y-3"><EmptyState title="Nothing re-planned yet" hint="Apply an event, then re-optimize. Minimal mode changes only deliveries on affected vehicles." />
                <div className="flex gap-2"><PrimaryButton onClick={() => reopt.mutate('MINIMAL')} disabled={!plan || busy}>Re-optimize (minimal disruption)</PrimaryButton><GhostButton onClick={() => reopt.mutate('FULL')} disabled={!plan || busy}>Full re-plan</GhostButton></div></div>
            ))}

            {tab === 'fleet' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">{state?.fleet.map(v => <div key={v.id} className={`rounded-xl border px-3 py-2 text-xs ${v.available ? 'border-slate-700' : 'border-red-500/40 bg-red-500/5'}`}><div className="flex justify-between"><b>{v.id}</b><Badge tone={v.available ? 'green' : 'red'}>{v.status}</Badge></div><div className="text-slate-400 mt-1">{v.name} · cap {v.capacity} · {v.fuelType}</div>{plan?.routes.find(r => r.vehicleId === v.id) && <div className="text-slate-500 mt-1">{plan.routes.find(r => r.vehicleId === v.id)!.stops.length} stops · load {plan.routes.find(r => r.vehicleId === v.id)!.load}/{v.capacity}</div>}</div>)}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Deliveries</div>
                <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead className="text-slate-500"><tr><th className="text-left py-1">ID</th><th className="text-left">Place</th><th>Prio</th><th>Window</th><th>Status</th></tr></thead><tbody>{state?.deliveries.map(d => <tr key={d.id} className="border-t border-slate-800/70"><td className="py-1 font-mono">{d.id}</td><td>{d.label}</td><td className="text-center">{d.priority}</td><td className="text-center">{fmtMin(d.windowStart)}–{fmtMin(d.windowEnd)}</td><td className="text-center">{d.status}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {tab === 'analysis' && <AnalysisTab plan={plan} analysis={analysis} run={runAnalysis} />}
          </div>
        </GlassCard>
      </div>

      {plan && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <Stat label="Plan" value={plan.dnaId} sub={plan.algorithm} />
          <Stat label="Fitness" value={f1(plan.fitness)} sub="lower = better" />
          <Stat label="Distance" value={`${f1(plan.totals.distanceKm)} km`} />
          <Stat label="Total time" value={`${f1(plan.totals.totalTimeMin)} min`} sub={`makespan ${f1(plan.totals.makespanMin)}`} />
          <Stat label="Fuel" value={`₹${plan.totals.fuelCostInr.toFixed(0)}`} />
          <Stat label="CO₂" value={`${plan.totals.co2Kg.toFixed(2)} kg`} sub="fuel-based estimate" />
          <Stat label="Lateness" value={`${f1(plan.totals.latenessMin)} min`} sub={`${plan.totals.lateStops} late stops`} />
          <Stat label="Unserved" value={plan.unassigned.length} sub={plan.feasible ? 'feasible' : 'constraints violated'} />
        </div>
      )}
      {plan && <GlassCard><div className="text-xs text-slate-400 mb-2">Convergence — measured from this run ({plan.iterations} iterations, {plan.evaluations} evaluations, {plan.runtimeSeconds.toFixed(2)} s)</div>
        <ConvergenceChart series={[{ name: plan.algorithm, data: plan.convergence, color: '#22d3ee' }]} height={180} />
        {plan.adaptive && <div className="mt-3"><div className="text-xs text-slate-400 mb-1">Adaptive β (contraction-expansion) and swarm diversity · {plan.adaptive.restarts} diversity restart(s)</div><ConvergenceChart series={[{ name: 'β', data: plan.adaptive.betaHistory, color: '#FF9933' }, { name: 'diversity', data: plan.adaptive.diversityHistory, color: '#a78bfa' }]} height={150} yLabel="value" /></div>}
      </GlassCard>}
      {analysis.execution && <GlassCard><div className="flex items-center gap-2 mb-2"><b className="text-sm">Predicted vs actual (this plan on the current network)</b><Badge tone="purple">SIMULATED_EXECUTION</Badge></div><div className="text-xs text-slate-400">{analysis.execution.rows.length} stops · learning store: {analysis.execution.learning?.message}</div></GlassCard>}
    </div>
  )
}

const clean = (e: any) => { const o: any = { type: e.type }; if (e.road) o.road = e.road; if (e.vehicleId) o.vehicleId = e.vehicleId; if (e.type === 'TRAFFIC_INCREASE') { o.percent = e.percent; if (e.road) o.scope = 'ROAD' } if (e.type === 'WEATHER_CHANGE') o.condition = e.condition; return o }

function ReplanView({ r }: { r: any }) {
  const cf = r.counterfactual
  return (
    <div className="space-y-3">
      {r.impact && <div className="rounded-xl bg-slate-900/50 border border-slate-800 p-3 text-xs space-y-1"><div className="text-[10px] uppercase tracking-wider text-slate-500">Impact on the committed plan (SIMULATED)</div><div>Affected vehicles: <b>{r.impact.affectedVehicles.join(', ') || 'none'}</b> · deliveries: <b>{r.impact.affectedDeliveries.join(', ') || 'none'}</b></div>{Object.entries(r.impact.reasons || {}).map(([k, v]) => <div key={k} className="text-slate-400">{k}: {String(v)}</div>)}<div>Plan time {f1(r.impact.baselineTotals.totalTimeMin)} → <b>{f1(r.impact.staleTotals.totalTimeMin)} min</b>, {r.impact.staleTotals.unassigned} unserved</div></div>}
      {cf && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="WITHOUT re-opt" value={`${f1(cf.withoutReoptimization.totalTimeMin)} min`} sub={`${cf.withoutReoptimization.unassigned} unserved · ${f1(cf.withoutReoptimization.latenessMin)} min late`} />
            <Stat label="WITH re-opt" value={`${f1(cf.withReoptimization.totalTimeMin)} min`} sub={`${cf.withReoptimization.unassigned} unserved · ${f1(cf.withReoptimization.latenessMin)} min late`} />
            <Stat label="Delay avoided" value={`${f1(cf.delayAvoidedMin)} min`} /><Stat label="Deliveries recovered" value={cf.deliveriesRecovered} />
          </div>
          <div className="text-[11px] text-slate-500">Mode: <b>{r.mode}</b>{r.mode === 'MINIMAL' ? ` — ${r.pinnedDeliveries} deliveries stayed on their vehicle` : ''}</div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Why the plan changed</div>
            <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-4">{r.explanation.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
          </div>
          {r.diff.reassigned.length > 0 && <table className="w-full text-[11px]"><thead className="text-slate-500"><tr><th className="text-left">Delivery</th><th className="text-left">From</th><th className="text-left">To</th></tr></thead><tbody>{r.diff.reassigned.map((x: any) => <tr key={x.deliveryId} className="border-t border-slate-800/70"><td className="py-1 font-mono">{x.deliveryId} <span className="text-slate-500">{x.label}</span></td><td>{x.from ?? '—'}</td><td className={x.to ? '' : 'text-red-400'}>{x.to ?? 'UNSERVED'}</td></tr>)}</tbody></table>}
        </>
      )}
      {!cf && <div className="text-xs text-slate-400">Event applied to the twin. Re-optimize from the Events tab to see the plan change.</div>}
    </div>
  )
}
