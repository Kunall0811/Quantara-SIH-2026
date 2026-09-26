import React, { useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
import api from '../api/client'
import { Badge, PrimaryButton } from './ui'

interface Check { name: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string; ms: number }

/** Runs the backend self-checks. Every row is the result of actually executing that subsystem — nothing is pre-marked as verified. */
export default function PlatformVerification() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [overall, setOverall] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async () => {
    setBusy(true); setErr(null)
    try { const { data } = await api.get('/health/full'); setChecks(data.checks); setOverall(data.overall) } catch (e: any) { setErr(e?.response?.data?.message || 'Verification request failed') } finally { setBusy(false) }
  }
  const Icon = (s: string) => s === 'PASS' ? <CheckCircle2 size={13} className="text-emerald-400" /> : s === 'WARN' ? <AlertTriangle size={13} className="text-yellow-400" /> : <XCircle size={13} className="text-red-400" />
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div><h2 className="text-lg font-semibold text-slate-200">Platform verification</h2><p className="text-xs text-slate-500">Executes the road graph, all six algorithms, constraint validator, benchmark engine, scenario engine, twin and FRIDAY registry on tiny instances.</p></div>
        <div className="flex items-center gap-2">{overall && <Badge tone={overall === 'PASS' ? 'green' : overall === 'WARN' ? 'yellow' : 'red'}>{overall}</Badge>}<PrimaryButton onClick={run} disabled={busy}>{busy ? <><Loader2 size={13} className="inline animate-spin mr-1" />Running…</> : 'Run verification'}</PrimaryButton></div>
      </div>
      {err && <div role="alert" className="text-xs text-red-400 mb-2">{err}</div>}
      {!checks && !busy && <div className="text-xs text-slate-500">Not run yet — no status is assumed.</div>}
      {checks && <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{checks.map(c => <div key={c.name} className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/50"><div className="flex items-center gap-2 mb-1">{Icon(c.status)}<span className="text-[11px] font-semibold text-slate-200 flex-1">{c.name}</span><span className="text-[9px] text-slate-500 font-mono">{c.ms} ms</span></div><div className="text-[10px] text-slate-400 leading-snug">{c.detail}</div></div>)}</div>}
    </div>
  )
}
