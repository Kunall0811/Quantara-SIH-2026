import React, { useState, useEffect, useRef } from 'react'
import { Mic, MicOff, X, Sparkles, Send, Volume2, ShieldCheck, Zap, Activity } from 'lucide-react'
import api from '../api/client'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

type FridayState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR'
interface Turn { role: 'user' | 'friday'; text: string }

const Waveform = ({ state, size = 'sm' }: { state: FridayState, size?: 'sm' | 'lg' }) => {
  const active = state === 'LISTENING' || state === 'SPEAKING';
  const thinking = state === 'THINKING';
  const hMax = size === 'lg' ? '32px' : '18px';
  const hMin = size === 'lg' ? '8px' : '4px';
  
  if (state === 'IDLE' || state === 'ERROR') {
    return <Sparkles size={size === 'lg' ? 24 : 18} className={state === 'ERROR' ? 'text-red-400' : 'text-accent'} />;
  }

  return (
    <>
      <style>{`
        @keyframes waveformAnim {
          0% { height: ${hMin}; opacity: 0.5; }
          100% { height: ${hMax}; opacity: 1; }
        }
        .animate-waveform {
          animation: waveformAnim 0.4s ease-in-out infinite alternate;
        }
      `}</style>
      <div className="flex items-center justify-center gap-1" style={{ height: hMax }}>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`rounded-full ${active ? 'bg-accent animate-waveform' : 'bg-quantum animate-pulse'}`}
            style={{ width: size === 'lg' ? '4px' : '3px', height: active ? '100%' : hMin, animationDelay: active ? `${i * 0.15}s` : '0s' }}
          />
        ))}
      </div>
    </>
  )
}

export default function FridayWidget() {
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [state, setState] = useState<FridayState>('IDLE')
  const [turns, setTurns] = useState<Turn[]>([{ role: 'friday', text: user?.role === 'admin' ? 'FRIDAY online. Fleet command is ready.' : 'FRIDAY online. Ask about your delivery, ETA, or route.' }])
  const [input, setInput] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null)
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  if (!user) return null

  useEffect(() => {
    const handleToggle = () => setOpen(o => !o);
    window.addEventListener('quantara:toggle-friday', handleToggle);
    return () => window.removeEventListener('quantara:toggle-friday', handleToggle);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Pre-load voices to avoid the default male voice on first turn
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    if (!voiceEnabled) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setState(s => s === 'SPEAKING' ? 'IDLE' : s);
    }
  }, [voiceEnabled]);

  const speak = async (text: string) => {
    if (!voiceEnabled || !isAdmin) return
    setState('SPEAKING')
    try {
      const res = await api.get('/friday/tts', { params: { text }, responseType: 'blob' })
      if (String(res.headers['content-type'] || '').includes('audio')) {
        const url = URL.createObjectURL(res.data)
        const audio = new Audio(url)
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); setState('IDLE'); audioRef.current = null; }
        await audio.play()
        return
      }
    } catch { /* browser fallback */ }
    
    if ('speechSynthesis' in window) {
      // Ensure any current speech is stopped before starting new
      window.speechSynthesis.cancel();
      
      let voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        // Wait a tiny bit for voices to load if it's the very first time
        await new Promise(r => setTimeout(r, 200));
        voices = window.speechSynthesis.getVoices();
      }
      
      const utter = new SpeechSynthesisUtterance(text)
      utter.rate = 1.0
      utter.pitch = 1.1
      utter.lang = 'en-IN'
      
      const preferred = voices.find((v) => /female|woman|zira|samantha|victoria|karen|veena|google.*female/i.test(v.name))
                     || voices.find((v) => !/male|man|david|mark|george|ravi/i.test(v.name));
      if (preferred) utter.voice = preferred
      utter.onend = () => setState('IDLE')
      window.speechSynthesis.speak(utter)
    } else {
      setState('IDLE')
    }
  }

  const executeLocalCommand = (commandText: string) => {
    const normalized = commandText.toLowerCase().trim();
    if (normalized.includes("show congestion")) {
      return "Congestion hotspots highlighted across the live graph network.";
    }
    if (normalized.includes("where is q-01") || normalized.includes("where is")) {
      const vehicleId = (normalized.match(/q-\d+/i)?.[0] || "Q-01").toUpperCase();
      window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'FOCUS_VEHICLE', vehicleId } }));
      return `Vehicle ${vehicleId} is currently active and tracked on the live map.`;
    }
    if (normalized.includes("night map") || normalized.includes("dark mode")) {
      window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'SET_MAP_MODE', mode: 'night' } }));
      return "Switching base map display to tactical dark mode.";
    }
    if (normalized.includes("optimize") || normalized.includes("reroute")) {
      navigate('/plan');
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'RUN_OPTIMIZATION' } })), 250);
      return "Quantum-inspired routing executed. Alternative low-congestion path applied.";
    }
    if (normalized.includes("weather")) {
      navigate('/weather');
      return "Opening the weather simulation engine.";
    }
    return null;
  };

  const send = async (text: string, confirmed = false) => {
    if (!text.trim()) return
    setTurns((t) => [...t, { role: 'user', text }])
    setInput('')

    const localResponse = executeLocalCommand(text);
    if (localResponse) {
      setTurns((t) => [...t, { role: 'friday', text: localResponse }]);
      await speak(localResponse);
      return;
    }

    setState('THINKING')
    try {
      const { data } = await api.post('/friday/chat', { text, confirmed, sessionId: 'friday-main', language: 'en' })
      setTurns((t) => [...t, { role: 'friday', text: data.text }])
      if (data.status === 'PENDING_CONFIRMATION') setPendingConfirm(text)
      else {
        setPendingConfirm(null)
        if (data.data?.navigate) navigate(`/${data.data.navigate}`)
        const action = data.data?.action || (data.data?.vehicle && { type: 'FOCUS_VEHICLE', vehicleId: data.data.vehicle.id, lat: data.data.vehicle.lat, lon: data.data.vehicle.lon })
        if (action) {
          if (action.type === 'NAVIGATE' && action.page) {
            navigate(`/${action.page}`)
            if (action.command === 'RUN_OPTIMIZATION') window.setTimeout(() => window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'RUN_OPTIMIZATION' } })), 250)
            if (action.command === 'START_MISSION') window.setTimeout(() => window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'START_MISSION' } })), 250)
            if (action.command === 'STOP_MISSION') window.setTimeout(() => window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'STOP_MISSION' } })), 250)
          } else window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: action }))
        }
      }
      await speak(data.text)
      setState('IDLE')
    } catch {
      setState('ERROR')
      setTurns((t) => [...t, { role: 'friday', text: 'I could not reach the operations service.' }])
    }
  }

  const toggleMic = () => {
    if (!isAdmin) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { 
      setTurns(t => [...t, { role: 'friday', text: 'Voice input is not supported in this browser. Please type your command.' }]);
      return;
    }
    if (state === 'LISTENING') { setState('IDLE'); return }
    try {
      const rec = new SR()
      rec.lang = 'en-IN'
      rec.interimResults = false
      rec.onresult = (e: any) => {
        if (e.results && e.results[0] && e.results[0][0]) {
          send(e.results[0][0].transcript);
        } else {
          setState('IDLE');
        }
      }
      rec.onerror = (e: any) => {
        console.error('Speech recognition error:', e.error);
        setState('IDLE');
        setTurns(t => [...t, { role: 'friday', text: `Voice recognition failed (${e.error}). Please type your command.` }]);
      }
      rec.onend = () => setState((s) => (s === 'LISTENING' ? 'IDLE' : s))
      rec.start()
      setState('LISTENING')
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setState('IDLE');
      setTurns(t => [...t, { role: 'friday', text: 'Could not access microphone. Please check permissions or type your command.' }]);
    }
  }

  const stateColor: Record<FridayState, string> = {
    IDLE: 'bg-emerald-400', LISTENING: 'bg-accent pulse-ring', THINKING: 'bg-quantum animate-pulse',
    SPEAKING: 'bg-emerald-400 animate-pulse', ERROR: 'bg-red-500',
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-6 right-6 w-16 h-16 rounded-full glass-strong flex items-center justify-center shadow-glowPurple group z-50 border border-accent/30 overflow-hidden">
        <div className={`absolute inset-0 opacity-20 ${state === 'LISTENING' || state === 'SPEAKING' ? 'bg-accent animate-pulse' : ''}`} />
        <span className={`absolute top-1 right-1 w-3 h-3 rounded-full ${stateColor[state]}`} />
        <div className="absolute inset-2 rounded-full border border-accent/30 animate-pulse" />
        <div className="z-10 group-hover:scale-110 transition flex items-center justify-center w-full h-full">
          <Waveform state={state} size="lg" />
        </div>
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 w-[390px] max-h-[620px] glass-strong rounded-3xl flex flex-col shadow-glowPurple overflow-hidden z-50 border border-accent/20">
      <div className="px-4 py-3 border-b border-slate-800/70 bg-slate-950/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-accent/30 to-quantum/30 flex items-center justify-center border border-accent/30 overflow-hidden">
              <div className={`absolute inset-0 opacity-20 ${state === 'LISTENING' || state === 'SPEAKING' ? 'bg-accent animate-pulse' : ''}`} />
              <div className="z-10"><Waveform state={state} size="sm" /></div>
              <span className={`absolute -right-1 -bottom-1 w-3 h-3 rounded-full ${stateColor[state]}`} />
            </div>
            <div>
              <div className="font-display font-semibold">FRIDAY</div>
              <div className="text-[10px] text-slate-500 flex items-center gap-1"><ShieldCheck size={10} /> {isAdmin ? 'ADMIN OPERATIONS' : 'DELIVERY ASSISTANT'}</div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200"><X size={16} /></button>
        </div>
        {isAdmin && <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-400"><div className="rounded-lg bg-slate-900/60 p-2"><Zap size={11} className="text-accent mb-1" />QPSO ready</div><div className="rounded-lg bg-slate-900/60 p-2"><Volume2 size={11} className="text-emerald-400 mb-1" />Voice on</div><div className="rounded-lg bg-slate-900/60 p-2">India<br/>LIVE</div></div>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm min-h-[300px]">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] px-3 py-2.5 rounded-2xl ${t.role === 'user' ? 'bg-accent/15 border border-accent/20 text-slate-100' : 'bg-slate-800/70 border border-slate-700/50 text-slate-200'}`}>{t.text}</div>
          </div>
        ))}
        {pendingConfirm && <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3"><div className="text-xs text-yellow-300 mb-2">Confirmation required</div><div className="flex gap-2"><button onClick={() => send(pendingConfirm, true)} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-base-950 font-semibold">Confirm</button><button onClick={() => setPendingConfirm(null)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">Cancel</button></div></div>}
      </div>

      <div className="p-3 border-t border-slate-800/70">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(isAdmin ? ['Optimize fleet', 'Show congestion', 'Where is Q-01?', 'Reroute Q-02', 'Switch to night map'] : ['Where is my delivery?', 'What is my ETA?', 'Is my delivery delayed?']).map((q) => <button key={q} onClick={() => send(q)} className="text-[10px] px-2.5 py-1.5 rounded-full border border-slate-700 text-slate-400 hover:text-accent hover:border-accent/30">{q}</button>)}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <button onClick={toggleMic} title="Admin voice commands only" className={`p-2.5 rounded-xl border ${state === 'LISTENING' ? 'border-accent text-accent bg-accent/10' : 'border-slate-700 text-slate-400'}`}>{state === 'LISTENING' ? <MicOff size={16} /> : <Mic size={16} />}</button>}
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(input)} placeholder={isAdmin ? 'Say or type: optimize the fleet' : 'Ask about your delivery'} className="flex-1 bg-base-800/80 border border-slate-700 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40" />
          <button onClick={() => send(input)} className="p-2.5 rounded-xl bg-accent text-base-950"><Send size={16} /></button>
        </div>
        {isAdmin && <button onClick={() => setVoiceEnabled((v) => !v)} className="mt-2 text-[10px] text-slate-500 hover:text-slate-300">Voice response: {voiceEnabled ? 'ON' : 'OFF'}</button>}
      </div>
    </div>
  )
}
