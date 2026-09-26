import React from 'react'

export function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass rounded-2xl p-5 ${className}`}>{children}</div>
}

export function KpiCard({
  label, value, suffix = '', accent = 'accent', icon,
}: { label: string; value: string | number; suffix?: string; accent?: 'accent' | 'quantum' | 'saffron'; icon?: React.ReactNode }) {
  const color = accent === 'quantum' ? 'text-quantum' : accent === 'saffron' ? 'text-saffron' : 'text-accent'
  return (
    <GlassCard className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-slate-400 text-xs uppercase tracking-wider">
        <span>{label}</span>
        {icon && <span className={color}>{icon}</span>}
      </div>
      <div className={`kpi-value text-3xl font-semibold ${color}`}>
        {value}<span className="text-base text-slate-400 ml-1">{suffix}</span>
      </div>
    </GlassCard>
  )
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'saffron' }) {
  const tones: Record<string, string> = {
    default: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
    purple: 'bg-quantum/15 text-quantum border-quantum/30',
    saffron: 'bg-saffron/15 text-saffron border-saffron/30',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>
}

export function trafficTone(level: string): 'green' | 'yellow' | 'orange' | 'red' | 'default' {
  switch (level) {
    case 'LOW': return 'green'
    case 'MODERATE': return 'yellow'
    case 'HIGH': return 'orange'
    case 'SEVERE': return 'red'
    default: return 'default'
  }
}

export function PrimaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`px-4 py-2 rounded-xl bg-gradient-to-r from-saffron via-accent to-indiagreen text-base-950 font-semibold text-sm
        hover:opacity-90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`px-4 py-2 rounded-xl border border-slate-700 text-slate-200 text-sm hover:bg-slate-800/60 transition
        disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100
        placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-accent/50 ${props.className || ''}`}
    />
  )
}

export function Select({ children, className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100
        focus:outline-none focus:ring-2 focus:ring-accent/50 ${className}`}
    >
      {children}
    </select>
  )
}

export function SourceBadge({ source }: { source: 'LIVE' | 'SIMULATED' | 'PREDICTED' | 'FALLBACK' | 'MEASURED' | string }) {
  const tone = source === 'LIVE' || source === 'MEASURED' ? 'green' : source === 'SIMULATED' ? 'purple' : source === 'PREDICTED' ? 'saffron' : 'default'
  return <Badge tone={tone as any}>{source}</Badge>
}

export function Stat({ label, value, sub, source }: { label: string; value: React.ReactNode; sub?: string; source?: string }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-slate-800/70 px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5 truncate">{label}{source && <span className="text-[9px] text-quantum">{source}</span>}</div>
      <div className="kpi-value text-lg text-slate-100 truncate">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 truncate">{sub}</div>}
    </div>
  )
}

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null
  return <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-xs px-3 py-2">{error}</div>
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center"><div className="text-sm text-slate-300">{title}</div>{hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}</div>
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight bg-gradient-to-r from-saffron via-slate-100 to-indiagreen bg-clip-text text-transparent">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400 mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}
