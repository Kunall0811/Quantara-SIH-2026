import React from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

export default function ConvergenceChart({ series, height = 220, yLabel = 'Best fitness (lower = better)' }: { series: { name: string; data: number[]; color: string }[]; height?: number; yLabel?: string }) {
  const n = Math.max(0, ...series.map(s => s.data.length))
  const rows = Array.from({ length: n }, (_, i) => Object.fromEntries([['i', i + 1], ...series.map(s => [s.name, s.data[i]])]))
  return (
    <div style={{ height }} role="img" aria-label={`Convergence chart: ${series.map(s => s.name).join(', ')}`}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(148,163,184,.12)" />
          <XAxis dataKey="i" stroke="#64748b" tick={{ fontSize: 10 }} label={{ value: 'iteration', position: 'insideBottomRight', offset: -2, fill: '#64748b', fontSize: 10 }} />
          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} width={44} label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 9, dx: 8 }} />
          <Tooltip contentStyle={{ background: '#0e1524', border: '1px solid rgba(148,163,184,.2)', borderRadius: 10, fontSize: 11 }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map(s => <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color} dot={false} strokeWidth={2} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
