import api from '../api/client'
import type { LatLon } from './types'

export const VEHICLE_COLORS = ['#22d3ee', '#FF9933', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#fb7185']
export const colorFor = (vehicleId: string, all: string[]) => VEHICLE_COLORS[Math.max(0, all.indexOf(vehicleId)) % VEHICLE_COLORS.length]

export type Src = 'LIVE' | 'SIMULATED' | 'PREDICTED' | 'FALLBACK' | 'MEASURED'
export interface RouteStep { index: number; instruction: string; maneuver: string; roadName: string; distanceKm: number; durationMin: number; location: LatLon }
export interface PlanStop { deliveryId: string; label: string; nodeId: string; arrival: number; serviceStart: number; waiting: number; lateness: number; windowStart: number; windowEnd: number }
export interface PlanRoute {
  vehicleId: string; stops: PlanStop[]; distanceKm: number; durationMin: number; totalTimeMin: number; fuelCostInr: number; co2Kg: number; riskScore: number
  load: number; capacity: number; latenessMin: number; lateStops: number; geometry: LatLon[]; geometrySource: 'LIVE' | 'FALLBACK'; steps?: RouteStep[]; edgePath: string[]
}
export interface Plan {
  id: string; dnaId: string; algorithm: string; seed: number; fitness: number; createdAt: string; scenario: string; twinVersion: number
  terms: Record<string, number>; totals: { distanceKm: number; totalTimeMin: number; fuelCostInr: number; co2Kg: number; riskScore: number; latenessMin: number; lateStops: number; makespanMin: number }
  routes: PlanRoute[]; unassigned: string[]; feasible: boolean; convergence: number[]; evaluations: number; iterations: number; runtimeSeconds: number
  adaptive?: { betaHistory: number[]; diversityHistory: number[]; restarts: number; stagnationHistory?: number[] }
  dataset: { label: string; customers: number; vehicles: number; startTimeMin: number }
}
export interface TwinState {
  loaded: boolean; version: number; label: string; seed: number; depotId: string
  network: { nodes: number; edges: number; closed: number; weather: string; speedFactor: number }
  fleet: { id: string; name: string; capacity: number; fuelType: string; available: boolean; status: string; note?: string }[]
  deliveries: { id: string; label: string; lat: number; lon: number; demand: number; priority: string; windowStart: number; windowEnd: number; status: string }[]
  events: { id: string; description: string; at: string; request: { type: string }; affectedRoadNames: string[]; twinVersion: number }[]
  currentPlanId: string | null; plans: { id: string; algorithm: string; fitness: number; dnaId: string; scenario: string }[]
  plan: Plan | null
}

export const fmtMin = (m: number) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${Math.round(m % 60).toString().padStart(2, '0')}`
export const f1 = (n: number | undefined | null) => (typeof n === 'number' && isFinite(n) ? n.toFixed(1) : '—')

export const twinApi = {
  state: () => api.get<TwinState & { success: boolean }>('/twin/state').then(r => r.data),
  load: (b: { customers: number; vehicles: number; seed: number }) => api.post('/twin/load', b).then(r => r.data),
  optimize: (b: { algorithm: string; maxIterations?: number; populationSize?: number; seed?: number }) => api.post('/twin/optimize', b).then(r => r.data.plan as Plan),
  event: (b: any) => api.post('/twin/events', b).then(r => r.data),
  reoptimize: (b: any) => api.post('/twin/reoptimize', b).then(r => r.data),
  resetEvents: () => api.post('/twin/reset-events').then(r => r.data),
  execute: () => api.post('/twin/execute', {}).then(r => r.data),
  dispatch: () => api.post('/twin/dispatch', {}).then(r => r.data),
  roads: (used = true) => api.get('/twin/roads', { params: used ? { used: 1 } : {} }).then(r => r.data.roads as { id: string; code: string; name: string; usedByPlan: number; closed: boolean }[]),
}
export const advApi = {
  scenario: (b: any) => api.post('/advanced/scenario', b).then(r => r.data),
  resilience: (b: any = {}) => api.post('/advanced/resilience', b).then(r => r.data),
  regret: (b: any = {}) => api.post('/advanced/regret', b).then(r => r.data),
  counterfactual: (b: any) => api.post('/advanced/counterfactual', b).then(r => r.data),
  timeWindows: () => api.post('/advanced/time-window-risk', {}).then(r => r.data),
  dna: (withAnalysis = false) => api.post('/advanced/route-dna', { withAnalysis }).then(r => r.data),
  explain: () => api.post('/advanced/explain', {}).then(r => r.data),
  learning: () => api.get('/advanced/learning').then(r => r.data),
}
export const demoApi = {
  state: () => api.get('/demo/state').then(r => r.data),
  start: (b: any) => api.post('/demo/start', b).then(r => r.data),
  pause: () => api.post('/demo/pause').then(r => r.data),
  resume: () => api.post('/demo/resume').then(r => r.data),
  reset: () => api.post('/demo/reset').then(r => r.data),
  next: () => api.post('/demo/next').then(r => r.data),
}
export const errMsg = (e: any) => e?.response?.data?.message || e?.message || 'Request failed'
