import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Pause, RotateCcw, SkipForward, CheckCircle2, Circle, Loader2, XCircle, Presentation } from 'lucide-react'
import api from '../api/client'
import QRouteMap from '../components/QRouteMap'
import ConvergenceChart from '../components/ConvergenceChart'
import DirectionsPanel from '../components/DirectionsPanel'
import { GlassCard, PrimaryButton, GhostButton, Badge, SourceBadge, Stat, ErrorNote, PageHeader, Input } from '../components/ui'
import { demoApi, colorFor, errMsg, Plan } from '../lib/twin'
import { useSocket } from '../lib/useSocket'

interface Step { index: number; id: string; title: string; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; durationMs?: number; error?: string; result?: { summary: string; metrics: { label: string; value: string; source?: string }[]; source: string; view: string; planId?: string; highlight?: { edgeIds?: string[]; deliveryIds?: string[]; vehicleIds?: string[] }; data?: any } }

export default function SihDemo() {
  const qc = useQueryClient()
  const { lastEvent } = useSocket()
  const [sel, setSel] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const [delay, setDelay] = useState(2500)
  const [error, setError] = useState<string | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [activeStep, setActiveStep] = useState<number | null>(null)

  const { data, refetch } = useQuery({ queryKey: ['demo'], queryFn: demoApi.state, refetchInterval: q => (q.state.data?.status === 'RUNNING' ? 1000 : 4000) })
  useEffect(() => { if (lastEvent?.event === 'demo_state') refetch() }, [lastEvent])

  const steps: Step[] = data?.steps ?? []
  const status: string = data?.status ?? 'IDLE'
  const current: number = data?.current ?? 0
  useEffect(() => { if (follow && current > 0) setSel(current) }, [current, follow])
  const shown = steps.find(s => s.index === sel) ?? null
  const planId = shown?.result?.planId

  const { data: stepPlan } = useQuery({ queryKey: ['demo-plan', planId, data?.twin?.version], enabled: !!planId, queryFn: () => api.get(`/twin/plans/${planId}`).then(r => r.data.plan as Plan) })
  const plan: Plan | null = stepPlan ?? data?.plan ?? null

  const act = (fn: () => Promise<any>) => async () => { setError(null); try { await fn(); await refetch() } catch (e) { setError(errMsg(e)) } }
  const vids = plan?.routes.map(r => r.vehicleId) ?? []
  const hi = shown?.result?.highlight
  const multiRoutes = useMemo(() => (plan?.routes ?? []).map(r => ({ vehicleId: r.vehicleId, geometry: r.geometry, color: hi?.vehicleIds?.includes(r.vehicleId) ? '#ef4444' : colorFor(r.vehicleId, vids) })), [plan, hi])
  const deliveries = data?.twin?.deliveries ?? []
  const waypoints = deliveries.map((d: any) => ({ lat: d.lat, lon: d.lon, label: `${d.id} · ${d.label}${hi?.deliveryIds?.includes(d.id) ? ' · AFFECTED' : ''}` }))
  const incidents = (data?.twin?.events ?? []).filter((e: any) => e.location).map((e: any) => ({ lat: e.location.lat, lon: e.location.lon, label: e.description, type: e.request.type, severity: 'HIGH' }))
  const r = shown?.result
  const d = r?.data

  return (
    <div className="space-y-4">
      <PageHeader title="SIH Demo Mode" subtitle="A 21-step walkthrough in which every step executes for real against the digital twin, optimizer, scenario engine, learning store and benchmark engine. Nothing on this page is scripted output."
        right={<div className="flex items-center gap-2"><Badge tone={status === 'RUNNING' ? 'green' : status === 'FAILED' ? 'red' : status === 'COMPLETED' ? 'purple' : 'default'}>{status}</Badge><span className="text-xs text-slate-400">{current}/21</span></div>} />
      <ErrorNote error={error || data?.error} />

      <GlassCard className="!p-3 flex flex-wrap items-center gap-2">
        {(status === 'IDLE' || status === 'COMPLETED' || status === 'FAILED') && <PrimaryButton onClick={act(() => demoApi.start({ delayMs: delay, auto: true, customers: 10, vehicles: 4, seed: 42 }))}><Play size={14} className="inline mr-1" />{status === 'IDLE' ? 'Start demo' : 'Run again'}</PrimaryButton>}
        {status === 'RUNNING' && <GhostButton onClick={act(demoApi.pause)}><Pause size={14} className="inline mr-1" />Pause</GhostButton>}
        {status === 'PAUSED' && <PrimaryButton onClick={act(demoApi.resume)}><Play size={14} className="inline mr-1" />Resume</PrimaryButton>}
        <GhostButton onClick={act(demoApi.next)} disabled={status === 'RUNNING' || status === 'COMPLETED'}><SkipForward size={14} className="inline mr-1" />Next step</GhostButton>
        <GhostButton onClick={act(demoApi.reset)}><RotateCcw size={14} className="inline mr-1" />Reset</GhostButton>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-2 ml-2">Pause between steps (ms)<Input type="number" min={0} max={30000} step={500} value={delay} onChange={e => setDelay(Number(e.target.value))} className="w-24" /></label>
        <label className="text-xs text-slate-400 flex items-center gap-1.5 ml-auto"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> follow live step</label>
      </GlassCard>

      <div className="grid xl:grid-cols-[280px_minmax(0,1.4fr)_minmax(340px,1fr)] gap-4">
        <GlassCard className="!p-3 max-h-[720px] overflow-y-auto">
          <ol className="space-y-1" aria-label="Demo steps">
            {steps.map(s => {
              const Icon = s.status === 'DONE' ? CheckCircle2 : s.status === 'RUNNING' ? Loader2 : s.status === 'FAILED' ? XCircle : Circle
              return (
                <li key={s.id}><button onClick={() => { setSel(s.index); setFollow(false) }} className={`w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-2 text-xs border transition ${sel === s.index ? 'bg-accent/10 border-accent/30 text-accent' : 'border-transparent text-slate-300 hover:bg-slate-800/50'}`}>
                  <Icon size={14} className={s.status === 'DONE' ? 'text-emerald-400' : s.status === 'RUNNING' ? 'text-saffron animate-spin' : s.status === 'FAILED' ? 'text-red-400' : 'text-slate-600'} />
                  <span className="w-5 text-slate-500 font-mono">{s.index}</span><span className="flex-1">{s.title}</span>{s.durationMs != null && <span className="text-[10px] text-slate-500">{s.durationMs < 1000 ? `${s.durationMs}ms` : `${(s.durationMs / 1000).toFixed(1)}s`}</span>}
                </button></li>
              )
            })}
          </ol>
        </GlassCard>

        <GlassCard className="!p-0 overflow-hidden h-[720px] relative">
          <QRouteMap height="100%" multiRoutes={multiRoutes} waypoints={waypoints} incidents={incidents} fitRoute />
          <div className="absolute top-3 left-3 z-10 glass-strong rounded-xl px-3 py-2 text-[10px] flex items-center gap-2"><Presentation size={12} className="text-quantum" />{plan ? `${plan.dnaId} · v${plan.twinVersion}` : 'No plan yet'}<SourceBadge source="SIMULATED" /></div>
        </GlassCard>

        <GlassCard className="max-h-[720px] overflow-y-auto space-y-3">
          {!shown && <div className="text-sm text-slate-400">Press <b>Start demo</b>. Each step will appear here with the numbers the backend actually computed.</div>}
          {shown && (
            <>
              <div className="flex items-start justify-between gap-2"><div><div className="text-[10px] uppercase tracking-wider text-slate-500">Step {shown.index} of 21</div><h2 className="font-display text-lg">{shown.title}</h2></div>{r && <SourceBadge source={r.source} />}</div>
              {shown.status === 'PENDING' && <div className="text-xs text-slate-500">Not run yet.</div>}
              {shown.status === 'RUNNING' && <div className="text-xs text-saffron flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Computing…</div>}
              {shown.error && <ErrorNote error={shown.error} />}
              {r && (
                <>
                  <p className="text-sm text-slate-200 leading-relaxed">{r.summary}</p>
                  <div className="grid grid-cols-2 gap-2">{r.metrics.slice(0, 10).map((m, i) => <Stat key={i} label={m.label} value={m.value} source={m.source} />)}</div>
                  {r.view === 'convergence' && d?.convergence && <ConvergenceChart series={[...(d.static ? [{ name: 'QPSO (original)', data: d.static as number[], color: '#22d3ee' }] : []), { name: shown.id === 'adaptive-qpso' ? 'Adaptive QPSO (replan)' : 'QPSO', data: d.convergence, color: shown.id === 'adaptive-qpso' ? '#FF9933' : '#22d3ee' }]} height={200} />}
                  {shown.id === 'adaptive-qpso' && d?.adaptive && <ConvergenceChart series={[{ name: 'β', data: d.adaptive.betaHistory, color: '#FF9933' }, { name: 'diversity', data: d.adaptive.diversityHistory, color: '#a78bfa' }]} height={150} yLabel="value" />}
                  {shown.id === 'show-routes' && plan && <DirectionsPanel routes={plan.routes} vehicleId={vehicle || plan.routes[0]?.vehicleId} onVehicle={setVehicle} activeStep={activeStep} onStep={setActiveStep} />}
                  {(shown.id === 'friday' || shown.id === 'recalc-routes') && (d?.why || d?.explanation) && <ul className="text-xs text-slate-300 list-disc pl-4 space-y-1">{(d.why || (Array.isArray(d.explanation) ? d.explanation : [])).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>}
                  <details className="text-[11px] text-slate-500"><summary className="cursor-pointer hover:text-slate-300">Raw backend data</summary><pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950/70 p-2 text-[10px]">{JSON.stringify(d, null, 1)?.slice(0, 6000)}</pre></details>
                </>
              )}
            </>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
