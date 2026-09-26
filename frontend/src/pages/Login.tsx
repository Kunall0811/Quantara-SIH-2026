import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, ArrowRight, Mail, Lock, User as UserIcon } from 'lucide-react'
import api from '../api/client'
import { useAuthStore } from '../store/authStore'
import IndiaRouteHero from '../components/IndiaRouteHero'

type Mode = 'login' | 'register' | 'verify'

const DEMO_ACCOUNTS = [
  { role: 'Citizen', email: 'citizen@qroute.in', password: 'citizen123' },
  { role: 'Admin', email: 'admin@qroute.in', password: 'admin123' },
]

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('citizen@qroute.in')
  const [password, setPassword] = useState('citizen123')
  const [otp, setOtp] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const doLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setAuth(data.token, data.user)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Login failed')
    } finally { setLoading(false) }
  }

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await api.post('/auth/register', { name, email, password })
      setDevOtp(data.devOtp || null)
      setNotice(data.emailDelivered ? 'Check your email for the verification code.' : 'Email not configured — use the code shown below (dev mode only).')
      setMode('verify')
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Registration failed')
    } finally { setLoading(false) }
  }

  const doVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/verify-otp', { email, code: otp })
      setNotice('Email verified! You can now sign in.')
      setMode('login')
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Verification failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 relative overflow-hidden">
      <div className="hidden lg:flex items-center justify-center relative bg-gradient-to-br from-base-900 to-base-950 border-r border-slate-800/70">
        <div className="absolute inset-0 grid-overlay opacity-30" />
        <div className="relative z-10 max-w-md text-center px-8">
          <IndiaRouteHero className="w-80 h-80 mx-auto float-y" />
          <h2 className="font-display text-2xl font-bold mt-4">Quantum-Inspired Route Intelligence</h2>
          <p className="text-slate-400 text-sm mt-2">
            Real QPSO optimization over live TomTom traffic and Open-Meteo weather data —
            built free-tier-first for Indian cities.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6 lg:hidden">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-saffron via-accent to-indiagreen flex items-center justify-center shadow-glow mb-2">
              <Zap size={22} className="text-base-950" />
            </div>
            <h1 className="font-display text-xl font-bold">Q-ROUTE INDIA</h1>
          </div>

          {mode === 'login' && (
            <form onSubmit={doLogin} className="glass-strong rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-lg font-semibold">Sign in</h2>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-3 text-slate-500" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
                  className="w-full pl-9 bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-3 text-slate-500" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
                  className="w-full pl-9 bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              {error && <div className="text-red-400 text-xs">{error}</div>}
              {notice && <div className="text-emerald-400 text-xs">{notice}</div>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-saffron via-accent to-indiagreen text-base-950 font-semibold text-sm hover:opacity-90 transition disabled:opacity-50">
                {loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={15} />
              </button>
              <p className="text-xs text-slate-500 text-center">
                No account? <button type="button" onClick={() => { setMode('register'); setError(''); setNotice('') }} className="text-accent hover:underline">Register</button>
              </p>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={doRegister} className="glass-strong rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-lg font-semibold">Create account</h2>
              <div className="relative">
                <UserIcon size={14} className="absolute left-3 top-3 text-slate-500" />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required
                  className="w-full pl-9 bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-3 text-slate-500" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" required
                  className="w-full pl-9 bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-3 text-slate-500" />
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password (min 6 chars)" required
                  className="w-full pl-9 bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              {error && <div className="text-red-400 text-xs">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-saffron via-accent to-indiagreen text-base-950 font-semibold text-sm hover:opacity-90 transition disabled:opacity-50">
                {loading ? 'Creating…' : 'Create account'} <ArrowRight size={15} />
              </button>
              <p className="text-xs text-slate-500 text-center">
                Already have an account? <button type="button" onClick={() => setMode('login')} className="text-accent hover:underline">Sign in</button>
              </p>
            </form>
          )}

          {mode === 'verify' && (
            <form onSubmit={doVerify} className="glass-strong rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-lg font-semibold">Verify your email</h2>
              <p className="text-xs text-slate-500">{notice}</p>
              {devOtp && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-300">
                  Dev mode (no Gmail SMTP configured) — your code is <b className="font-mono text-sm">{devOtp}</b>
                </div>
              )}
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" maxLength={6} required
                className="w-full bg-base-800/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-accent/50" />
              {error && <div className="text-red-400 text-xs">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-saffron via-accent to-indiagreen text-base-950 font-semibold text-sm hover:opacity-90 transition disabled:opacity-50">
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>
            </form>
          )}

          <div className="mt-6 glass rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Demo accounts</div>
            <div className="grid grid-cols-1 gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} onClick={() => { setMode('login'); setEmail(a.email); setPassword(a.password) }}
                  className="text-left text-xs px-3 py-1.5 rounded-lg hover:bg-slate-800/60 transition flex justify-between text-slate-400">
                  <span>{a.role}</span><span className="text-slate-600">{a.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
