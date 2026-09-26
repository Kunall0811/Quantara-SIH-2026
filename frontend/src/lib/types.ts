export interface LatLon { lat: number; lon: number; lng?: number; label?: string }

export interface VehicleProfile {
  type: 'car' | 'truck' | 'ambulance' | 'delivery' | 'bus' | 'two_wheeler'
  maxSpeedKmph: number
  fuelEfficiencyKmPerL: number
  fuelType: 'petrol' | 'diesel' | 'electric' | 'cng'
  capacityKg: number
  priority: 'normal' | 'high' | 'emergency'
}

export interface OptimizationResponse {
  success: boolean
  id: string
  algorithm: string
  bestFitness: number
  distanceKm: number
  durationMinutes: number
  fuelCostInr: number
  co2Kg: number
  runtimeSeconds: number
  iterations: number
  convergence: number[]
  geometry: LatLon[]
  explanation: string[]
  trafficDelayMinutes: number
  avgCongestionPct: number
  waypointOrder?: number[]
}

export interface RouteCalcResponse {
  success: boolean
  provider: 'tomtom' | 'osrm' | 'internal'
  fallbackUsed: boolean
  distanceKm: number
  durationMinutes: number
  trafficDelayMinutes: number
  geometry: LatLon[]
  instructions: string[]
  trafficLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
  legs?: Array<{ from: LatLon; to: LatLon; distanceKm: number; durationMinutes: number; provider: string }>
}
