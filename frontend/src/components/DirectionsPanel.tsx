import React from 'react'
import { ArrowUp, ArrowLeft, ArrowRight, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight, CornerUpLeft, Flag, MapPin, Play } from 'lucide-react'
import type { PlanRoute } from '../lib/twin'
import { colorFor } from '../lib/twin'
import { SourceBadge } from './ui'

const ICON: Record<string, any> = { depart: Play, straight: ArrowUp, left: ArrowLeft, right: ArrowRight, 'slight-left': ArrowUpLeft, 'slight-right': ArrowUpRight, 'sharp-left': ArrowDownLeft, 'sharp-right': ArrowDownRight, uturn: CornerUpLeft, arrive: Flag, stop: MapPin }
const fmtDist = (km: number) => (km <= 0 ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)

/** Turn-by-turn list for one vehicle; clicking a step highlights it on the map. Steps come from the backend's evaluated path. */
export default function DirectionsPanel({ routes, vehicleId, onVehicle, activeStep, onStep }: {
  routes: PlanRoute[]; vehicleId: string; onVehicle: (id: string) => void; activeStep: number | null; onStep: (i: number | null) => void
}) {
  const all = routes.map(r => r.vehicleId)
  const route = routes.find(r => r.vehicleId === vehicleId) || routes[0]
  if (!route) return null
  const steps = route.steps || []
  const c = colorFor(route.vehicleId, all)
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {routes.map(r => (
          <button key={r.vehicleId} onClick={() => { onVehicle(r.vehicleId); onStep(null) }}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${r.vehicleId === route.vehicleId ? 'text-slate-950 font-semibold' : 'text-slate-300 border-slate-700 hover:bg-slate-800/60'}`}
            style={r.vehicleId === route.vehicleId ? { background: colorFor(r.vehicleId, all), borderColor: colorFor(r.vehicleId, all) } : undefined}>{r.vehicleId}</button>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
        <span>{route.distanceKm.toFixed(1)} km · {Math.round(route.totalTimeMin)} min · {route.stops.length} stops</span>
        <span className="flex items-center gap-1">Geometry <SourceBadge source={route.geometrySource} /></span>
      </div>
      <ol className="overflow-y-auto pr-1 space-y-1 max-h-[420px]" aria-label={`Turn-by-turn directions for ${route.vehicleId}`}>
        {steps.map(s => {
          const Icon = ICON[s.maneuver] || ArrowUp
          const active = activeStep === s.index
          return (
            <li key={s.index}>
              <button onClick={() => onStep(active ? null : s.index)} className={`w-full text-left flex items-start gap-2.5 rounded-lg px-2.5 py-2 border transition ${active ? 'bg-slate-800 border-accent/50' : 'border-transparent hover:bg-slate-800/50'}`}>
                <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center" style={{ background: `${c}22`, color: c }}><Icon size={13} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-slate-100 leading-snug">{s.instruction}</span>
                  {(s.distanceKm > 0 || s.durationMin > 0) && <span className="block text-[10px] text-slate-500">{fmtDist(s.distanceKm)}{s.durationMin > 0 ? ` · ${s.durationMin.toFixed(1)} min` : ''}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
