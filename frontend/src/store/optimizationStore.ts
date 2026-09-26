import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface OptimizationState {
  algorithm: string;
  populationSize: number;
  maxIterations: number;
  origin: string;
  destination: string;
  vehicleType: string;
  currentIteration: number;
  totalIterations: number;
  fleetOptimizationResult: any;
  selectedVehicles: string[];
  selectedStops: string[];
  
  setAlgorithm: (v: string) => void;
  setPopulationSize: (v: number) => void;
  setMaxIterations: (v: number) => void;
  setOrigin: (v: string) => void;
  setDestination: (v: string) => void;
  setVehicleType: (v: string) => void;
  setProgress: (current: number, total: number) => void;
  setFleetOptimizationResult: (v: any) => void;
  setSelectedVehicles: (v: string[]) => void;
  setSelectedStops: (v: string[]) => void;
}

export const useOptimizationStore = create<OptimizationState>()(
  persist(
    (set) => ({
      algorithm: 'QPSO',
      populationSize: 30,
      maxIterations: 100,
      origin: 'Pune — Shivajinagar',
      destination: 'Pune — Hinjewadi',
      vehicleType: 'delivery',
      currentIteration: 0,
      totalIterations: 0,
      fleetOptimizationResult: null,
      selectedVehicles: ['Q-01', 'Q-02'],
      selectedStops: ['Shivajinagar', 'Baner', 'Hinjewadi', 'Kothrud', 'Aundh'],
      
      setAlgorithm: (v) => set({ algorithm: v }),
      setPopulationSize: (v) => set({ populationSize: v }),
      setMaxIterations: (v) => set({ maxIterations: v }),
      setOrigin: (v) => set({ origin: v }),
      setDestination: (v) => set({ destination: v }),
      setVehicleType: (v) => set({ vehicleType: v }),
      setProgress: (current, total) => set((state) => ({ currentIteration: Math.max(state.currentIteration, current), totalIterations: total })),
      setFleetOptimizationResult: (v) => set({ fleetOptimizationResult: v }),
      setSelectedVehicles: (v) => set({ selectedVehicles: v }),
      setSelectedStops: (v) => set({ selectedStops: v }),
    }),
    {
      name: 'quantara-optimization-store',
    }
  )
)
