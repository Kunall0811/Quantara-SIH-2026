import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Play } from 'lucide-react'
import { GlassCard, PrimaryButton, GhostButton, Select, Input, Badge, SourceBadge, Stat, ErrorNote, EmptyState, PageHeader } from '../components/ui'
import AnalysisTab from '../components/AnalysisPanels'
import { twinApi, advApi, errMsg, f1 } from '../lib/twin'

const TYPES = ['ACCIDENT', 'ROAD_CLOSURE', 'TRAFFIC_INCREASE', 'VEHICLE_BREAKDOWN', 'WEATHER_CHANGE']

/**
 * Advanced Decision Lab. Everything here is computed by the backend on a CLONE of the live digital twin
 * (the twin itself is never modified). There are no numbers in this file except UI defaults for the inputs.
 */
export default function AdvancedLab() {
  const qc = useQueryClient()
  const { data: state, isLoading } = useQuery({ queryKey: ['twin'], queryFn: twinApi.state })
  const { data: roads } = useQuery({ queryKey: ['twin-roads', state?.currentPlanId], queryFn: () => twinApi.roads(true), enabled: !!state?.loaded && !!state?.currentPlanId })
  const { data: learning, refetch: refetchLearning } = useQuery({ queryKey: ['learning'], queryFn: advApi.learning })
  const [evt, setEvt] = useState<any>({ type: 'ACCIDENT', road: '', vehicleId: '', percent: 40, condition: 'Heavy Rain' })
  const [out, setOut] = useState<any>(null)
  const [analysis, setAnalysis] = useState<any>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [obs, setObs] = useState({ predicted: 20, actual: 24 })
  const plan = state?.plan ?? null

  const guard = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn() } catch (e) { setError(errMsg(e)) } finally { setBusy(false) } }
  const bootstrap = () => guard(async () => { await twinApi.load({ customers: 10, vehicles: 4, seed: 42 }); await twinApi.optimize({ algorithm: 'QPSO', maxIterations: 80 }); await qc.invalidateQueries({ queryKey: ['twin'] }) })
  const body = () => { const o: any = { type: evt.type }; if (evt.road) { o.road = evt.road; if (evt.type === 'TRAFFIC_INCREASE') o.scope = 'ROAD' } if (evt.vehicleId) o.vehicleId = evt.vehicleId; if (evt.type === 'TRAFFIC_INCREASE') { o.percent = evt.percent; if (!evt.road) o.scope = 'ALL' } if (evt.type === 'WEATHER_CHANGE') o.condition = evt.condition; return o }
  const preview = () => guard(async () => setOut(await advApi.scenario({ requests: [body()], maxIterations: 60 })))
  const run = (key: string, fn: () => Promise<any>) => () => guard(async () => { setAnalysis((a: any) => ({ ...a, [key]: { loading: true } })); try { const r = await fn(); setAnalysis((a: any) => ({ ...a, [key]: r })) } catch (e) { setAnalysis((a: any) => ({ ...a, [key]: undefined })); throw e } })
  const record = () => guard(async () => { await import('../api/client').then(m => m.default.post('/advanced/actual-vs-predicted', { predictedEtaMinutes: obs.predicted, actualEtaMinutes: obs.actual, source: 'MEASURED' })); await refetchLearning() })

  if (isLoading) return <div className="text-sm text-slate-400">Loading…</div>
  if (!plan) return (
    <div className="space-y-4">
      <PageHeader title="Advanced Decision Lab" subtitle="Scenario, resilience, regret, counterfactual and explainability analysis — all computed from the digital twin." />
      <ErrorNote error={error} />
      <GlassCard><EmptyState title="No active plan on the digital twin" hint="The lab analyses a real plan. Create one now (10 deliveries, 4 vehicles, QPSO) or use the Digital Twin page." /><div className="flex justify-center mt-4"><PrimaryButton onClick={bootstrap} disabled={busy}><Play size={14} className="inline mr-1" />{busy ? 'Building…' : 'Load twin and optimize'}</PrimaryButton></div></GlassCard>
    </div>
  )

  const cf = out?.counterfactual
  return (
    <div className="space-y-4">
      <PageHeader title="Advanced Decision Lab" subtitle={`Analysing ${plan.dnaId} (${plan.algorithm}, twin v${state?.version}). Each run is a simulation on a clone — the live twin is never changed.`} right={<div className="flex gap-2"><Badge tone="purple">dry-run</Badge><SourceBadge source="SIMULATED" /></div>} />
      <ErrorNote error={error} />

      <div className="grid xl:grid-cols-2 gap-4">
        <GlassCard className="space-y-3">
          <div className="flex items-center gap-2"><FlaskConical size={16} className="text-accent" /><h2 className="text-sm font-semibold">What-if scenario</h2></div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Event<Select value={evt.type} onChange={e => setEvt({ ...evt, type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</Select></label>
            {['ACCIDENT', 'ROAD_CLOSURE', 'TRAFFIC_INCREASE'].includes(evt.type) && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Road<Select value={evt.road} onChange={e => setEvt({ ...evt, road: e.target.value })}><option value="">{evt.type === 'TRAFFIC_INCREASE' ? 'Whole network' : 'Busiest road on plan'}</option>{roads?.map(r => <option key={r.id} value={r.code}>{r.code} · {r.name}</option>)}</Select></label>}
            {evt.type === 'TRAFFIC_INCREASE' && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Increase (%)<Input type="number" min={1} max={500} value={evt.percent} onChange={e => setEvt({ ...evt, percent: Number(e.target.value) })} /></label>}
            {evt.type === 'VEHICLE_BREAKDOWN' && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Vehicle<Select value={evt.vehicleId} onChange={e => setEvt({ ...evt, vehicleId: e.target.value })}><option value="">Busiest vehicle</option>{state?.fleet.filter(v => v.available).map(v => <option key={v.id}>{v.id}</option>)}</Select></label>}
            {evt.type === 'WEATHER_CHANGE' && <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Condition<Select value={evt.condition} onChange={e => setEvt({ ...evt, condition: e.target.value })}>{['Light Rain', 'Heavy Rain', 'Dense Fog', 'Storm'].map(c => <option key={c}>{c}</option>)}</Select></label>}
          </div>
          <PrimaryButton onClick={preview} disabled={busy}>{busy ? 'Simulating…' : 'Simulate scenario'}</PrimaryButton>
          {out && (
            <div className="space-y-3">
              <p className="text-xs text-slate-300">{out.description}</p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Baseline" value={`${f1(out.baseline.totalTimeMin)} min`} sub={`${out.baseline.unassigned} unserved`} />
                <Stat label="Keep plan" value={`${f1(out.withoutReoptimization.totalTimeMin)} min`} sub={`${out.withoutReoptimization.unassigned} unserved · ${f1(out.withoutReoptimization.latenessMin)} late`} />
                <Stat label="Re-optimize" value={`${f1(out.withReoptimization.totalTimeMin)} min`} sub={`${out.withReoptimization.unassigned} unserved · ${f1(out.withReoptimization.latenessMin)} late`} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Delay avoided" value={`${f1(cf.delayAvoidedMin)} min`} /><Stat label="Fuel saved" value={`₹${cf.fuelSavedInr.toFixed(0)}`} /><Stat label="CO₂ saved" value={`${cf.co2SavedKg.toFixed(2)} kg`} /><Stat label="Recovered" value={cf.deliveriesRecovered} sub="deliveries" />
              </div>
              <div className="flex gap-1.5 flex-wrap"><Badge tone={out.survivedWithoutReopt ? 'green' : 'red'}>keep plan: {out.survivedWithoutReopt ? 'survives' : 'fails'}</Badge><Badge tone={out.survivedWithReopt ? 'green' : 'red'}>re-optimized: {out.survivedWithReopt ? 'survives' : 'fails'}</Badge><Badge>+{f1(out.extraTimePctWithoutReopt)}% time if kept</Badge></div>
              <div className="text-xs text-slate-400">Affected vehicles: <b className="text-slate-200">{out.affectedVehicles.join(', ') || 'none'}</b> · deliveries: <b className="text-slate-200">{out.affectedDeliveries.join(', ') || 'none'}</b></div>
              {out.diff.reassigned.length > 0 && <div className="text-xs text-slate-400">Reassignments: {out.diff.reassigned.map((r: any) => `${r.deliveryId} ${r.from ?? '—'}→${r.to ?? 'UNSERVED'}`).join(', ')}</div>}
              <p className="text-[10px] text-slate-500">{out.method}</p>
            </div>
          )}
        </GlassCard>

        <GlassCard><h2 className="text-sm font-semibold mb-3">Plan analysis</h2><AnalysisTab plan={plan} analysis={analysis} run={(k, fn) => run(k, fn)} /></GlassCard>
      </div>

      <GlassCard className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2"><h2 className="text-sm font-semibold">Actual vs predicted — learning loop</h2>{learning && <Badge tone={learning.summary.status === 'OK' ? 'green' : 'yellow'}>{learning.summary.status}</Badge>}</div>
        <p className="text-xs text-slate-400">{learning?.summary.message}</p>
        {learning?.summary.overall && <div className="grid grid-cols-2 md:grid-cols-5 gap-2"><Stat label="Samples" value={learning.summary.samples} /><Stat label="MAE" value={`${f1(learning.summary.overall.maeMin)} min`} /><Stat label="Bias" value={`${f1(learning.summary.overall.biasMin)} min`} /><Stat label="MAPE" value={`${f1(learning.summary.overall.mapePct)}%`} /><Stat label="ETA correction" value={learning.correction.available ? `×${learning.correction.factor}` : 'n/a'} sub={learning.correction.available ? 'advisory' : 'insufficient data'} /></div>}
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Predicted ETA (min)<Input type="number" min={0} className="w-28" value={obs.predicted} onChange={e => setObs({ ...obs, predicted: Number(e.target.value) })} /></label>
          <label className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">Actual ETA (min)<Input type="number" min={0} className="w-28" value={obs.actual} onChange={e => setObs({ ...obs, actual: Number(e.target.value) })} /></label>
          <GhostButton onClick={record} disabled={busy}>Record measured observation</GhostButton>
          <span className="text-[10px] text-slate-500">Observations from “Simulate execution” are labelled SIMULATED_EXECUTION and are never mixed up with measured data.</span>
        </div>
      </GlassCard>
    </div>
  )
}
