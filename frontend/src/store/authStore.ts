import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Role = 'citizen' | 'admin'

interface User {
  id: string
  name: string
  email: string
  role: Role
  emailVerified?: boolean
}

interface AuthState {
  token: string | null
  user: User | null
  pendingMission: any | null
  setAuth: (token: string, user: User) => void
  setPendingMission: (mission: any | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      pendingMission: null,
      setAuth: (token, user) => set({ token, user }),
      setPendingMission: (pendingMission) => set({ pendingMission }),
      logout: () => set({ token: null, user: null, pendingMission: null }),
    }),
    { name: 'qroute-india-auth' },
  ),
)
