import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export function useSocket(room?: string) {
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<{ event: string; data: any } | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io('/', { path: '/socket.io' })
    socketRef.current = socket
    socket.on('connect', () => {
      setConnected(true)
      if (room) socket.emit('join', room)
    })
    socket.on('disconnect', () => setConnected(false))
    const events = ['optimization_progress', 'optimization_complete', 'traffic_update', 'fleet_update', 'vehicle_location', 'mission_update', 'incident_update', 'citizen_mission_dispatched', 'twin_event', 'twin_plan', 'demo_state']
    events.forEach((e) => socket.on(e, (data) => setLastEvent({ event: e, data })))
    return () => { socket.disconnect() }
  }, [room])

  return { connected, lastEvent, socket: socketRef.current }
}
