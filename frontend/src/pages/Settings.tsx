import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Settings as SettingsIcon } from 'lucide-react'
import api from '../api/client'
import { GlassCard, Badge } from '../components/ui'
import { useAuthStore } from '../store/authStore'

export default function Settings() {
  const { user } = useAuthStore()
  const { data: health } = useQuery({ queryKey: ['services-health'], queryFn: async () => (await api.get('/health/services')).data })
  const { data: friday } = useQuery({ queryKey: ['friday-status'], queryFn: async () => (await api.get('/friday/status')).data })

  const tone = (v: string) => v === 'healthy' || v === 'configured' ? 'green' : v === 'not_configured' ? 'default' : 'red'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><SettingsIcon className="text-accent" size={22} /> Settings</h1>
        <p className="text-slate-500 text-sm">Account and integration status</p>
      </div>

      <GlassCard>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Account</h3>
        <div className="text-sm text-slate-400">Name: <span className="text-slate-200">{user?.name}</span></div>
        <div className="text-sm text-slate-400">Email: <span className="text-slate-200">{user?.email}</span></div>
        <div className="text-sm text-slate-400">Role: <Badge tone="purple">{user?.role}</Badge></div>
      </GlassCard>

      <GlassCard>
        <h3 className="text-sm font-medium text-slate-300 mb-3">External Service Health</h3>
        <p className="text-xs text-slate-500 mb-3">Free-tier-first: every service below has a working fallback if unconfigured or unreachable.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {health && Object.entries(health).filter(([k]) => k !== 'success').map(([name, status]) => (
            <div key={name} className="flex items-center justify-between bg-slate-800/40 rounded-lg px-3 py-2">
              <span className="text-xs text-slate-400 capitalize">{name}</span>
              <Badge tone={tone(String(status)) as any}>{String(status)}</Badge>
            </div>
          ))}
        </div>
      </GlassCard>

      {friday && (
        <GlassCard>
          <h3 className="text-sm font-medium text-slate-300 mb-3">FRIDAY Assistant</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-800/40 rounded-lg px-3 py-2"><div className="text-slate-500">Brain</div><div className="text-slate-200">{friday.llm}</div></div>
            <div className="bg-slate-800/40 rounded-lg px-3 py-2"><div className="text-slate-500">Voice Out</div><div className="text-slate-200">{friday.voiceOutput}</div></div>
            <div className="bg-slate-800/40 rounded-lg px-3 py-2"><div className="text-slate-500">Voice In</div><div className="text-slate-200">{friday.voiceInput}</div></div>
            <div className="bg-slate-800/40 rounded-lg px-3 py-2"><div className="text-slate-500">Tools</div><div className="text-slate-200">{friday.toolsAvailable}</div></div>
          </div>
        </GlassCard>
      )}
    </div>
  )
}
