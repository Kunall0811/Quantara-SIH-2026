import React, { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart3, Play } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ErrorBar, LineChart, Line, Legend } from 'recharts'
import api from '../api/client'
import { GlassCard, PrimaryButton, Input, Badge, SourceBadge, Stat, ErrorNote, PageHeader, EmptyState } from '../components/ui'
import { errMsg, f1 } from '../lib/twin'

const ALL = ['QPSO', 'AQPSO', 'PSO', 'GA', 'SA', 'EXACT']
const COLORS: Record<string, string> = { QPSO: '#22d3ee', AQPSO: '#FF9933', PSO: '#a78bfa', GA: '#34d399', SA: '#f472b6', EXACT: '#facc15' }

export default function Benchmarking() {
  const [cfg, setCfg] = useState({ customers: 8, vehicleCount: 3, datasetSeed: 26137, populationSize: 30, maxIterations: 100 })
  const [algos, setAlgos] = useState<string[]>(ALL)
  const [showRuns, setShowRuns] = useState(false)
  const latest = useQuery({ queryKey: ['bench-latest'], queryFn: () => api.get('/optimization/benchmark/latest').then(r => r.data) })
  const run = useMutation({ mutationFn: async () => (await api.post('/optimization/benchmark', { ...cfg, algorithms: algos })).data })
  const rep = run.data ?? (latest.data?.available ? latest.data : null)
  const results = rep ? Object.values(rep.results as Record<string, any>) : []
  const ranked: any[] = rep?.ranking ?? []
  const bars = ranked.map(r => ({ algorithm: r.algorithm, mean: Number(r.meanFitness.toFixed(2)), sd: Number((rep.results[r.algorithm].stdDevFitness ?? 0).toFixed(2)) }))
  const maxLen = Math.max(0, ...results.map((r: any) => r.convergence.length))
  const conv = Array.from({ length: maxLen }, (_, i) => Object.fromEntries([['i', i + 1], ...results.map((r: any) => [r.algorithm, r.convergence[i]])]))
  const m = rep?.meta

  return (
    <div className="space-y-4">
      <PageHeader title="Algorithm Benchmarking" subtitle="Every number is measured: the same generated problem, the same objective and evaluation budget, five fixed seeds, no post-processing. QPSO and Adaptive QPSO are quantum-inspired classical algorithms — they do not use quantum hardware."
        right={<div className="flex items-center gap-2"><SourceBadge source="MEASURED" />{run.data && <Badge tone="green">fresh run</Badge>}{!run.data && rep && <Badge>latest stored run</Badge>}</div>} />
      <ErrorNote error={run.isError ? errMsg(run.error) : null} />

      <GlassCard className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([['customers', 'Customers', 2, 120], ['vehicleCount', 'Vehicles', 1, 20], ['datasetSeed', 'Dataset seed', 0, 1e9], ['populationSize', 'Population', 4, 100], ['maxIterations', 'Iterations', 5, 300]] as const).map(([k, l, min, max]) => (
            <label key={k} className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">{l}<Input type="number" min={min} max={max} value={(cfg as any)[k]} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ALL.map(a => <label key={a} className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer transition ${algos.includes(a) ? 'border-accent/40 bg-accent/10 text-accent' : 'border-slate-700 text-slate-400'}`}><input type="checkbox" className="sr-only" checked={algos.includes(a)} onChange={() => setAlgos(algos.includes(a) ? algos.filter(x => x !== a) : [...algos, a])} />{a}</label>)}
          <span className="text-[10px] text-slate-500">EXACT is skipped automatically above 9 customers.</span>
          <PrimaryButton className="ml-auto" onClick={() => run.mutate()} disabled={run.isPending || !algos.length}><Play size={14} className="inline mr-1" />{run.isPending ? 'Running 5 seeds × algorithms…' : 'Run benchmark'}</PrimaryButton>
        </div>
      </GlassCard>

      {!rep && <GlassCard><EmptyState title="No benchmark has been run yet" hint="Run one above — nothing is displayed until real runs exist." /></GlassCard>}
      {rep && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            <Stat label="Dataset" value={`${m.customers} × ${m.vehicles}`} sub="customers × vehicles" /><Stat label="Seeds" value={m.seeds.join(', ')} /><Stat label="Budget" value={m.evaluationBudget} sub="evaluations / run" />
            <Stat label="Total runtime" value={`${f1(m.totalRuntimeSeconds)} s`} /><Stat label="CPU" value={`${m.hardware.cores} cores`} sub={m.hardware.cpu} /><Stat label="Graph" value={`${m.graphNodes} nodes`} sub={`${m.graphEdges} edges`} />
          </div>

          <div className="grid xl:grid-cols-2 gap-4">
            <GlassCard>
              <h3 className="text-sm font-semibold mb-2">Mean fitness ± std (lower is better)</h3>
              <div style={{ height: 240 }}><ResponsiveContainer><BarChart data={bars}><CartesianGrid stroke="rgba(148,163,184,.12)" /><XAxis dataKey="algorithm" stroke="#64748b" tick={{ fontSize: 11 }} /><YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} /><Tooltip contentStyle={{ background: '#0e1524', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10, fontSize: 11 }} /><Bar dataKey="mean" fill="#22d3ee" radius={[6, 6, 0, 0]}><ErrorBar dataKey="sd" stroke="#FF9933" width={6} /></Bar></BarChart></ResponsiveContainer></div>
            </GlassCard>
            <GlassCard>
              <h3 className="text-sm font-semibold mb-2">Mean convergence across seeds</h3>
              <div style={{ height: 240 }}><ResponsiveContainer><LineChart data={conv}><CartesianGrid stroke="rgba(148,163,184,.12)" /><XAxis dataKey="i" stroke="#64748b" tick={{ fontSize: 10 }} /><YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} /><Tooltip contentStyle={{ background: '#0e1524', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 11 }} />{results.filter((r: any) => !r.isExact).map((r: any) => <Line key={r.algorithm} dataKey={r.algorithm} stroke={COLORS[r.algorithm]} dot={false} strokeWidth={2} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div>
              <p className="text-[10px] text-slate-500 mt-1">x-axis: generation/iteration index of each algorithm's own recorded history (SA records per-batch); each algorithm used the same evaluation budget.</p>
            </GlassCard>
          </div>

          <GlassCard className="overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]"><thead className="text-slate-500"><tr>{['Algorithm', 'Best', 'Mean', 'Worst', 'Median', 'Std', 'Runtime (s)', 'Evals', 'Feasible', 'Gap vs exact', 'vs QPSO (Mann–Whitney)'].map(h => <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>{ranked.map((r, i) => { const a = rep.results[r.algorithm]; const v = a.vsQPSO; return (
                <tr key={r.algorithm} className="border-t border-slate-800/70"><td className="py-2 pr-3 font-semibold" style={{ color: COLORS[r.algorithm] }}>{i + 1}. {r.algorithm}{a.isExact && <Badge tone="saffron"> exact</Badge>}</td>
                  <td>{f1(a.bestFitness)}</td><td>{f1(a.meanFitness)}</td><td>{f1(a.worstFitness)}</td><td>{f1(a.medianFitness)}</td><td>{f1(a.stdDevFitness)}</td><td>{a.meanRuntime.toFixed(2)}</td><td>{Math.round(a.meanEvaluations)}</td><td>{Math.round(a.feasibilityRate * 100)}%</td>
                  <td>{a.optimalityGapPct != null ? `${a.optimalityGapPct.toFixed(2)}%` : 'n/a'}</td>
                  <td>{v ? <span title={v.note}><Badge tone={v.verdict === 'better' ? 'green' : v.verdict === 'worse' ? 'red' : 'default'}>{v.verdict}</Badge> <span className="text-slate-500">p={v.pValue.toFixed(3)} · {v.meanDiffPct >= 0 ? '+' : ''}{v.meanDiffPct.toFixed(2)}%</span></span> : '—'}</td></tr>) })}</tbody></table>
            {m.algorithmsSkipped.length > 0 && <div className="mt-3 space-y-1">{m.algorithmsSkipped.map((s: any) => <div key={s.algorithm} className="text-[11px] text-yellow-400/90">⚠ {s.algorithm} not executed: {s.reason}</div>)}</div>}
            <p className="text-[10px] text-slate-500 mt-3">“indistinguishable” means the difference is within what five seeds can resolve (p ≥ 0.05). A gap on one generated instance is not evidence of general superiority.</p>
          </GlassCard>

          <GlassCard className="space-y-2">
            <h3 className="text-sm font-semibold">Fairness protocol & provenance</h3>
            <ul className="text-xs text-slate-400 list-disc pl-4 space-y-1">{m.fairness.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
            <div className="text-[10px] text-slate-500 break-all">Run {m.id} · dataset {m.datasetLabel} · fingerprint {m.datasetFingerprint} · path cache {m.pathCache.hits} hits / {m.pathCache.misses} misses</div>
            <button onClick={() => setShowRuns(!showRuns)} className="text-xs text-accent">{showRuns ? 'Hide' : 'Show'} all {rep.runs.length} individual runs</button>
            {showRuns && <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead className="text-slate-500"><tr><th className="text-left">Algo</th><th>Seed</th><th>Fitness</th><th>Dist km</th><th>Time min</th><th>Runtime s</th><th>Evals</th><th>Feasible</th></tr></thead><tbody>{rep.runs.map((r: any, i: number) => <tr key={i} className="border-t border-slate-800/70 text-center"><td className="text-left py-1">{r.algorithm}</td><td>{r.seed}</td><td>{f1(r.bestFitness)}</td><td>{f1(r.distanceKm)}</td><td>{f1(r.travelTimeMin)}</td><td>{r.runtimeSeconds.toFixed(3)}</td><td>{r.evaluations}</td><td>{r.feasible ? 'yes' : 'no'}</td></tr>)}</tbody></table></div>}
          </GlassCard>
        </>
      )}
    </div>
  )
}
