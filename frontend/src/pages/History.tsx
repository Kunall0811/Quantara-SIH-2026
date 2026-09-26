import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, PieChart } from 'lucide-react'
import api from '../api/client'
import { GlassCard, Badge, KpiCard, PrimaryButton, EmptyState, SourceBadge, PageHeader } from '../components/ui'

/** Qualitative seasonal planning notes. These are guidance for planners, NOT measured statistics — they contain no invented figures. */
const PLAYBOOK: Record<string, { title: string; note: string; action: string }> = {
  'General Operations': { title: 'General operations', note: 'Use the Digital Twin to keep a live plan and re-plan after each disruption instead of reacting route-by-route.', action: 'Run resilience and time-window checks before dispatch; review the lowest-slack deliveries first.' },
  'Monsoon (Jul–Sep)': { title: 'Monsoon', note: 'Heavy rain slows the whole network and makes waterlogged closures likelier; the twin models this as a network-wide speed factor plus added congestion.', action: 'Simulate “Heavy Rain” and a road closure in the Advanced Lab and check which deliveries lose their time-window slack.' },
  'Winter fog (Nov–Jan)': { title: 'Winter fog', note: 'Low visibility reduces safe speeds, mostly on highways and in early-morning hours.', action: 'Simulate “Dense Fog”; consider later dispatch for non-urgent deliveries if slack allows.' },
  'Summer heat (Apr–Jun)': { title: 'Summer heat', note: 'Midday heat stresses vehicles and EV range.', action: 'Prefer routes with fewer stop-start segments for EVs and check fuel/energy cost terms in the plan explanation.' },
  'Festival peaks': { title: 'Festival peaks', note: 'Commercial areas see sharply higher traffic around festival evenings.', action: 'Apply a network-wide traffic increase in the twin and compare “keep plan” vs “re-optimize”.' },
}

export default function History() {
  const { data: results } = useQuery({ queryKey: ['opt-results'], queryFn: async () => (await api.get('/optimization/results')).data })
  const { data: dash } = useQuery({ queryKey: ['admin-dash-reports'], queryFn: async () => (await api.get('/admin/dashboard')).data })
  const { data: learning } = useQuery({ queryKey: ['learning'], queryFn: async () => (await api.get('/advanced/learning')).data })
  const rows: any[] = results?.results ?? []
  const years = useMemo(() => [...new Set(rows.map(r => new Date(r.createdAt).getFullYear()))].sort((a, b) => b - a), [rows])
  const [year, setYear] = useState<string>('all')
  const [scenario, setScenario] = useState('General Operations')
  const [rain, setRain] = useState(20), [load, setLoad] = useState(60), [pot, setPot] = useState(15)
  const shown = year === 'all' ? rows : rows.filter(r => String(new Date(r.createdAt).getFullYear()) === year)
  const rhi = Math.max(0, Math.min(100, Math.round(100 - rain * 0.35 - load * 0.45 - pot * 0.2)))
  const guide = PLAYBOOK[scenario]

  const download = () => {
    const csv = 'Algorithm,Distance (km),Duration (min),Fuel Cost (INR),CO2 (kg),Fitness,Date\n' + shown.map(r => `${r.algorithm},${r.distanceKm},${r.durationMinutes},${r.fuelCostInr},${r.co2Kg},${r.bestFitness},${new Date(r.createdAt).toISOString()}`).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `quantara_runs_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Reports & Analytics" subtitle="Archived optimization runs, platform counters, and the actual-vs-predicted learning loop. Only recorded data is shown; sections without data say so."
        right={<div className="flex items-center gap-2"><select aria-label="year" value={year} onChange={e => setYear(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm"><option value="all">All years</option>{years.map(y => <option key={y} value={String(y)}>{y}</option>)}</select><PrimaryButton onClick={download} disabled={!shown.length}><FileDown size={14} className="inline mr-1" />CSV</PrimaryButton></div>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Active incidents" value={dash?.activeIncidents ?? '—'} />
        <KpiCard label="Optimization runs" value={dash?.totalOptimizationRuns ?? '—'} />
        <KpiCard label="Network congestion" value={dash?.traffic?.avgCongestionPct ?? '—'} suffix={dash?.traffic ? '%' : ''} />
        <KpiCard label="Learning observations" value={learning?.summary?.samples ?? 0} accent="quantum" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <GlassCard>
            <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold">Actual vs predicted ETA</h3>{learning && <Badge tone={learning.summary.status === 'OK' ? 'green' : 'yellow'}>{learning.summary.status}</Badge>}</div>
            <p className="text-xs text-slate-400">{learning?.summary?.message ?? 'Loading…'}</p>
            {learning?.summary?.overall && <div className="grid grid-cols-4 gap-2 mt-3 text-xs">{[['MAE', `${learning.summary.overall.maeMin.toFixed(1)} min`], ['Bias', `${learning.summary.overall.biasMin.toFixed(1)} min`], ['MAPE', `${learning.summary.overall.mapePct.toFixed(1)}%`], ['RMSE', `${learning.summary.overall.rmseMin.toFixed(1)} min`]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-900/50 border border-slate-800 p-2"><div className="text-slate-500 text-[10px]">{k}</div><div className="text-slate-100 font-semibold">{v}</div></div>)}</div>}
            {learning?.summary?.status === 'OK' && learning.summary.byWeather?.length > 0 && <div className="mt-3 text-xs text-slate-400">By weather: {learning.summary.byWeather.map((w: any) => `${w.key} (MAE ${w.maeMin.toFixed(1)} min, n=${w.n})`).join(' · ')}</div>}
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold">Planning playbook</h3><Badge>guidance, not statistics</Badge></div>
            <select aria-label="scenario" value={scenario} onChange={e => setScenario(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm mb-3">{Object.keys(PLAYBOOK).map(k => <option key={k}>{k}</option>)}</select>
            <p className="text-sm text-slate-300"><b>{guide.title}:</b> {guide.note}</p><p className="text-sm text-accent/90 mt-1">{guide.action}</p>
            <h4 className="text-xs uppercase tracking-wider text-slate-500 mt-5 mb-2">Road health index — illustrative formula</h4>
            <div className="grid grid-cols-3 gap-4">{([['Rain intensity', rain, setRain], ['Vehicle load', load, setLoad], ['Road degradation', pot, setPot]] as const).map(([l, v, set]) => <label key={l} className="text-xs text-slate-500">{l}: {v}<input type="range" min={0} max={100} value={v} onChange={e => set(Number(e.target.value))} className="w-full accent-accent" /></label>)}</div>
            <div className="mt-2 text-sm">RHI = <span className={rhi > 80 ? 'text-green-400' : rhi > 50 ? 'text-yellow-400' : 'text-red-400'}>{rhi}%</span> <span className="text-[10px] text-slate-500">= 100 − 0.35·rain − 0.45·load − 0.20·degradation (transparent what-if formula, not a measurement)</span></div>
          </GlassCard>
        </div>

        <GlassCard className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between"><h3 className="text-sm font-medium flex items-center gap-2"><PieChart size={14} className="text-accent" />Archived runs {year !== 'all' && `(${year})`}</h3><SourceBadge source="MEASURED" /></div>
          <div className="max-h-[520px] overflow-y-auto">
            {!shown.length ? <div className="p-4"><EmptyState title="No archived runs" hint={rows.length ? 'No runs in this year.' : 'Run an optimization to create the first record.'} /></div> : (
              <table className="w-full text-sm"><thead className="bg-slate-800/40 text-slate-400 text-xs uppercase sticky top-0"><tr><th className="text-left px-4 py-2">Algorithm</th><th className="text-left px-4 py-2">Dist</th><th className="text-left px-4 py-2">Time</th></tr></thead>
                <tbody>{shown.map((r: any) => <tr key={r.id} className="border-t border-slate-800/60"><td className="px-4 py-3"><Badge tone="purple">{r.algorithm}</Badge></td><td className="px-4 py-3">{r.distanceKm} km</td><td className="px-4 py-3">{Math.round(r.durationMinutes)}m</td></tr>)}</tbody></table>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
