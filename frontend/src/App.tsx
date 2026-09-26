import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Layout from './components/Layout'
import Login from './pages/Login'

// Route-level code splitting: each page (and its charting / map dependencies) is loaded on demand.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PlanOptimize = lazy(() => import('./pages/PlanOptimize'))
const Traffic = lazy(() => import('./pages/Traffic'))
const Benchmarking = lazy(() => import('./pages/Benchmarking'))
const Scalability = lazy(() => import('./pages/Scalability'))
const History = lazy(() => import('./pages/History'))
const Settings = lazy(() => import('./pages/Settings'))
const Admin = lazy(() => import('./pages/Admin'))
const Notifications = lazy(() => import('./pages/Notifications'))
const AssignTask = lazy(() => import('./pages/AssignTask'))
const Weather = lazy(() => import('./pages/Weather'))
const AdvancedLab = lazy(() => import('./pages/AdvancedLab'))
const DigitalTwin = lazy(() => import('./pages/DigitalTwin'))
const SihDemo = lazy(() => import('./pages/SihDemo'))

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const token = useAuthStore(s => s.token)
  const role = useAuthStore(s => s.user?.role)
  if (!token) return <Navigate to="/login" replace />
  if (adminOnly && role !== 'admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
const admin = (el: React.ReactNode) => <ProtectedRoute adminOnly>{el}</ProtectedRoute>
const Fallback = <div className="p-6 text-sm text-slate-400" role="status" aria-live="polite">Loading…</div>

export default function App() {
  return (
    <Suspense fallback={Fallback}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/plan" element={admin(<PlanOptimize />)} />
          <Route path="/traffic" element={admin(<Traffic />)} />
          <Route path="/assign-task" element={admin(<AssignTask />)} />
          <Route path="/weather" element={admin(<Weather />)} />
          <Route path="/benchmarking" element={admin(<Benchmarking />)} />
          <Route path="/scalability" element={admin(<Scalability />)} />
          <Route path="/history" element={admin(<History />)} />
          <Route path="/twin" element={admin(<DigitalTwin />)} />
          <Route path="/advanced" element={admin(<AdvancedLab />)} />
          <Route path="/sih-demo" element={admin(<SihDemo />)} />
          <Route path="/admin" element={admin(<Admin />)} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
