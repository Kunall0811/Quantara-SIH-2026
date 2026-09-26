import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { TrendingUp, Play } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import api from '../api/client'
import { GlassCard, PrimaryButton, Input, Badge, SourceBadge, Stat, ErrorNote, PageHeader, EmptyState } from '../components/ui'
import { errMsg, f1 } from '../lib/twin'

const SIZES = [10, 25, 50, 100, 250, 500]
const ALGOS = ['QPSO', 'AQPSO', 'PSO', 'GA', 'SA']

export default function Scalability() {
  const [sizes, setSizes] = useState<number[]>(SIZES)
  const [algos, setAlgos] = useState<string[]>(['QPSO'])
  const [cfg, setCfg] = useState({ vehicleCount: 8, populationSize: 30, maxIterations: 100, perRunLimitSeconds: 60, seed: 26137 })
  const run = useMutation({ mutationFn: async () => (await api.post('/scalability/run', { ...cfg, customerCounts: sizes, algorithms: algos })).data })
  const rows: any[] = run.data?.results ?? []
  const measured = rows.filter(r => r.status === 'MEASURED')
  const chart = SIZES.filter(n => sizes.includes(n)).map(n => Object.fromEntries([['n', n], ...algos.map(a => [a, measured.find(r => r.customers === n && r.algorithm === a)?.runtimeSeconds])]))

  return (
    <div className="space-y-4">
      <PageHeader title="Scalability Testing" subtitle="Real optimizer runs at N = 10, 25, 50, 100, 250, 500 customers. Sizes whose extrapolated runtime exceeds the per-run limit are reported NOT EXECUTED with the reason — never estimated." right={<SourceBadge source="MEASURED" />} />
      <ErrorNote error={run.isError ? errMsg(run.error) : null} />
      <GlassCard className="space-y-3">
        <div className="flex flex-wrap gap-2">{SIZES.map(n => <label key={n} className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer ${sizes.includes(n) ? 'border-accent/40 bg-accent/10 text-accent' : 'border-slate-700 text-slate-400'}`}><input className="sr-only" type="checkbox" checked={sizes.includes(n)} onChange={() => setSizes(sizes.includes(n) ? sizes.filter(x => x !== n) : [...sizes, n].sort((a, b) => a - b))} />N = {n}</label>)}
          <span className="w-px bg-slate-800 mx-1" />{ALGOS.map(a => <label key={a} className={`text-xs px-3 py-1.5 rounded-full border cursor-pointer ${algos.includes(a) ? 'border-saffron/40 bg-saffron/10 text-saffron' : 'border-slate-700 text-slate-400'}`}><input className="sr-only" type="checkbox" checked={algos.includes(a)} onChange={() => setAlgos(algos.includes(a) ? algos.filter(x => x !== a) : [...algos, a])} />{a}</label>)}</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          {([['vehicleCount', 'Vehicles'], ['populationSize', 'Population'], ['maxIterations', 'Iterations'], ['perRunLimitSeconds', 'Per-run limit (s)'], ['seed', 'Seed']] as const).map(([k, l]) => <label key={k} className="text-[10px] uppercase tracking-wider text-slate-500 flex flex-col gap-1">{l}<Input type="number" value={(cfg as any)[k]} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></label>)}
          <PrimaryButton onClick={() => run.mutate()} disabled={run.isPending || !sizes.length || !algos.length}><Play size={14} className="inline mr-1" />{run.isPending ? 'Measuring…' : 'Run'}</PrimaryButton>
        </div>
        {run.isPending && <div className="text-xs text-saffron">Running real optimizations — large sizes can take a minute.</div>}
      </GlassCard>

      {!run.data && <GlassCard><EmptyState title="No results yet" hint="Run the test to measure runtime, evaluations and memory on this machine." /></GlassCard>}
      {run.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Stat label="Hardware" value={`${run.data.hardware.cores} cores`} sub={run.data.hardware.cpu} /><Stat label="Memory" value={`${run.data.hardware.totalMemGB} GB`} sub={run.data.hardware.node} /><Stat label="Largest measured" value={run.data.summary?.largestMeasured ?? '—'} /><Stat label="Not executed" value={run.data.summary?.notExecuted ?? 0} /></div>
          <GlassCard><h3 className="text-sm font-semibold mb-2">Runtime vs instance size (measured)</h3><div style={{ height: 260 }}><ResponsiveContainer><LineChart data={chart}><CartesianGrid stroke="rgba(148,163,184,.12)" /><XAxis dataKey="n" stroke="#64748b" tick={{ fontSize: 11 }} /><YAxis stroke="#64748b" tick={{ fontSize: 10 }} label={{ value: 'seconds', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#0e1524', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10, fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 11 }} />{algos.map((a, i) => <Line key={a} dataKey={a} stroke={['#22d3ee', '#FF9933', '#a78bfa', '#34d399', '#f472b6'][i % 5]} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></GlassCard>
          <GlassCard className="overflow-x-auto"><table className="w-full text-xs min-w-[760px]"><thead className="text-slate-500"><tr>{['N', 'Algorithm', 'Status', 'Runtime (s)', 'Fitness', 'Evals', 'Vehicles used', 'Unassigned', 'Heap Δ (MB)', 'Feasible'].map(h => <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => r.status === 'MEASURED' ? <tr key={i} className="border-t border-slate-800/70"><td className="py-2">{r.customers}</td><td>{r.algorithm}</td><td><Badge tone="green">MEASURED</Badge></td><td>{r.runtimeSeconds}</td><td>{f1(r.bestFitness)}</td><td>{r.evaluations}</td><td>{r.vehiclesUsed}</td><td>{r.unassigned}</td><td>{r.heapDeltaMB}</td><td>{r.feasible ? 'yes' : 'no'}</td></tr>
              : <tr key={i} className="border-t border-slate-800/70"><td className="py-2">{r.customers}</td><td>{r.algorithm}</td><td><Badge tone="yellow">NOT EXECUTED</Badge></td><td colSpan={7} className="text-slate-400">{r.reason}</td></tr>)}</tbody></table>
            <p className="text-[10px] text-slate-500 mt-3">{run.data.method}</p></GlassCard>
        </>
      )}
    </div>
  )
}
