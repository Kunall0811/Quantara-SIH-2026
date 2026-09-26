import React,{useEffect,useMemo,useState} from 'react'
import {NavLink,Outlet,useNavigate,useLocation} from 'react-router-dom'
import { LayoutDashboard, Route as RouteIcon, History, Settings as SettingsIcon, LogOut, Radio, ShieldCheck, Map, CloudRain, Bell, Navigation, BarChart3, TrendingUp, Menu, X, Zap, Sun, Moon, MapPinned, Truck, Bot, Package, BrainCircuit, Boxes, Presentation } from 'lucide-react'
import {useAuthStore} from '../store/authStore'
import {useSocket} from '../lib/useSocket'
import FridayWidget from './FridayWidget'
import { CITY_PRESETS } from '../lib/cities'
const ADMIN_NAV=[{to:'/dashboard',label:'Command Center',icon:LayoutDashboard},{to:'/plan',label:'Plan & Optimize',icon:RouteIcon},{to:'/traffic',label:'Traffic',icon:Radio},{to:'/assign-task',label:'Assign Task',icon:Navigation},{to:'/weather',label:'Weather',icon:CloudRain},{to:'/benchmarking',label:'Benchmarking',icon:BarChart3},{to:'/scalability',label:'Scalability',icon:TrendingUp},{to:'/history',label:'Reports & Analytics',icon:History},{to:'/twin',label:'Digital Twin',icon:Boxes},{to:'/advanced',label:'Advanced Decision Lab',icon:BrainCircuit},{to:'/sih-demo',label:'SIH Demo Mode',icon:Presentation},{to:'/notifications',label:'Notifications',icon:Bell},{to:'/settings',label:'Settings',icon:SettingsIcon},{to:'/admin',label:'Admin Control',icon:ShieldCheck}]
const CITIZEN_NAV=[{to:'/dashboard',label:'My Delivery',icon:Package},{to:'/notifications',label:'Notifications',icon:Bell},{to:'/settings',label:'Account & Support',icon:SettingsIcon}]
export default function Layout() {
  const { user, logout, setPendingMission } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const { lastEvent } = useSocket(user?.role === 'citizen' ? 'citizen-dashboard' : undefined);
  useEffect(() => {
    if (lastEvent?.event === 'citizen_mission_dispatched') {
      setPendingMission(lastEvent.data);
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    }
  }, [lastEvent, setPendingMission]);
  
  // Theme logic
  const [themeMode, setThemeMode] = useState<'auto'|'day'|'night'>(
    (localStorage.getItem('quantara_theme') as any) || 'auto'
  );
  
  const [city, setCity] = useState(() => localStorage.getItem('quantara_city') || 'Pune');
  const CITIES = Object.keys(CITY_PRESETS);
  
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = window.setInterval(() => setHour(new Date().getHours()), 60000);
    return () => window.clearInterval(t);
  }, []);
  
  const isNight = themeMode === 'auto' ? (hour >= 19 || hour < 6) : themeMode === 'night';
  const greeting = useMemo(() => hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening', [hour]);
  
  useEffect(() => {
    document.documentElement.dataset.mode = isNight ? 'night' : 'day';
    // Dispatch an event so QRouteMap knows the theme changed manually
    window.dispatchEvent(new CustomEvent('quantara:friday-action', { detail: { type: 'SET_MAP_MODE', mode: isNight ? 'night' : 'day' } }));
  }, [isNight]);

  const toggleTheme = () => {
    const next = themeMode === 'auto' ? 'day' : themeMode === 'day' ? 'night' : 'auto';
    setThemeMode(next);
    localStorage.setItem('quantara_theme', next);
  };

  const nav = user?.role === 'admin' ? ADMIN_NAV : CITIZEN_NAV;
  
  return (
    <div className="h-screen w-full overflow-hidden flex flex-col md:flex-row bg-base-950 transition-colors duration-700">
      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-slate-800/70 bg-base-950 z-20 relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-saffron via-accent to-indiagreen flex items-center justify-center shadow-glow">
            <Zap size={14} className="text-base-950"/>
          </div>
          <div className="font-display font-semibold text-sm">QUANTARA</div>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={city} 
            onChange={(e) => { setCity(e.target.value); localStorage.setItem('quantara_city', e.target.value); window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: e.target.value } })); }}
            className="text-[10px] bg-slate-800/50 border border-slate-700/50 rounded-md px-1 py-1 text-slate-300 outline-none focus:border-accent/50 cursor-pointer"
          >
            {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={toggleTheme} className="text-slate-400">
            {themeMode === 'auto' ? <Zap size={16}/> : themeMode === 'day' ? <Sun size={16}/> : <Moon size={16}/>}
          </button>
          <button onClick={() => { logout(); navigate('/login'); }} className="text-slate-500 hover:text-red-400">
            <LogOut size={18}/>
          </button>
        </div>
      </div>

      <aside className="hidden md:flex w-64 shrink-0 border-r border-slate-800/70 glass-strong flex-col z-20 relative">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-slate-800/70">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-saffron via-accent to-indiagreen flex items-center justify-center shadow-glow">
            <Zap size={17} className="text-base-950"/>
          </div>
          <div>
            <div className="font-display font-semibold text-sm tracking-wide">QUANTARA</div>
            <div className="text-[10px] text-slate-500 mt-1">India · Fleet Intelligence</div>
          </div>
        </div>
        
        <div className="px-4 py-3 border-b border-slate-800/70 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400"/>System online
          </div>
          <div className="flex items-center gap-2">
            <select 
              value={city} 
              onChange={(e) => { setCity(e.target.value); localStorage.setItem('quantara_city', e.target.value); window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: e.target.value } })); }}
              className="text-[10px] bg-slate-800/50 border border-slate-700/50 rounded-md px-1.5 py-1 text-slate-300 outline-none focus:border-accent/50 cursor-pointer"
            >
              {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={toggleTheme} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition bg-slate-800/50 px-2 py-1 rounded-md">
              {themeMode === 'auto' ? 'AUTO' : themeMode === 'day' ? <><Sun size={12}/> DAY</> : <><Moon size={12}/> NIGHT</>}
            </button>
          </div>
        </div>
        
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} className={({isActive}) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${isActive ? 'bg-accent/10 text-accent border border-accent/20 shadow-glow' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'}`}>
              <n.icon size={16}/>{n.label}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-3 border-t border-slate-800/70">
          <div className="mb-2 px-3 py-2 rounded-xl bg-slate-900/50 text-[10px] text-slate-500 flex items-center gap-2">
            <MapPinned size={12} className="text-accent"/> India operations · {greeting}
          </div>
          <div className="flex items-center justify-between px-2 py-2 rounded-lg bg-slate-800/40">
            <div>
              <div className="text-xs font-medium text-slate-200">{user?.name}</div>
              <div className="text-[10px] text-slate-500 uppercase">{user?.role}</div>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-slate-500 hover:text-red-400">
              <LogOut size={16}/>
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 grid-overlay relative flex flex-col overflow-hidden">
        <div className="flex-1 relative w-full h-full p-4 md:p-5 lg:p-6 max-w-[1800px] mx-auto overflow-y-auto">
          <Outlet/>
        </div>
      </main>
      
      {/* Mobile Bottom Nav */}
      <div className="md:hidden flex items-center justify-around p-3 border-t border-slate-800/70 bg-base-950 z-20 relative">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} className={({isActive}) => `flex flex-col items-center gap-1 text-[10px] ${isActive ? 'text-accent' : 'text-slate-500'}`}>
            <n.icon size={20}/>
            {n.label}
          </NavLink>
        ))}
      </div>
      <button onClick={() => window.dispatchEvent(new CustomEvent('quantara:toggle-friday'))} className="fixed top-4 right-5 z-40 hidden xl:flex items-center gap-2 px-3 py-2 rounded-full glass text-[10px] text-slate-400 hover:text-slate-200 transition">
        <Truck size={12} className="text-accent"/> {user?.role === 'admin' ? 'LIVE FLEET · CONTROL' : 'DELIVERY TRACKING'}
        <span className="mx-1 text-slate-700">|</span>
        <Bot size={12} className="text-quantum"/> FRIDAY {user?.role === 'admin' ? 'VOICE' : 'CHAT'}
      </button>
      <FridayWidget/>
    </div>
  );
}
