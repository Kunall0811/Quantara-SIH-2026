import React, { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { Map as MLMap, Marker, Popup, LngLatBounds } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLon } from '../lib/types'

const DAY_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const NIGHT_STYLE = 'https://tiles.openfreemap.org/styles/dark'

export interface FleetVehicle { id: string; lat: number; lon: number; speed: number; status: 'ON_ROUTE' | 'DELAYED' | 'IDLE' | 'OFFLINE'; eta: string; deliveries: number; heading?: number }
export interface MapStep { index: number; lat: number; lon: number; maneuver: string; instruction: string; distanceKm?: number; color?: string }
const MANEUVER_GLYPH: Record<string, string> = { depart: '▶', straight: '↑', 'slight-left': '↖', left: '←', 'sharp-left': '↙', 'slight-right': '↗', right: '→', 'sharp-right': '↘', uturn: '⮌', arrive: '⚑', stop: '◆', roundabout: '⟳', merge: '⇢', fork: '⑂' }
export interface IncidentMarker extends LatLon { id?: string; type?: string; severity?: string }

interface Props {
  height?: string | number
  origin?: LatLon | null
  destination?: LatLon | null
  waypoints?: LatLon[]
  routeGeometry?: LatLon[]
  multiRoutes?: { vehicleId: string; geometry: LatLon[]; color: string }[]
  focus?: { lat?: number; lon?: number; zoom?: number; bounds?: [[number, number], [number, number]] } | null
  pitch3d?: boolean
  vehicles?: FleetVehicle[]
  incidents?: IncidentMarker[]
  intelligenceEvents?: any[]
  autoTheme?: boolean
  showControls?: boolean
  fitRoute?: boolean
  onMapClick?: (point: LatLon) => void
  onIncidentDoubleClick?: (id: string) => void
  /** turn-by-turn maneuver markers (from the backend's real step list) and the currently selected step */
  steps?: MapStep[]
  activeStep?: number | null
}

// ─── Synchronous canvas arrow for map layer icons ───────────────────────────
function makeArrowCanvas(size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size; c.height = size
  const ctx = c.getContext('2d')!
  const hw = size / 2
  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.moveTo(hw, 2)
  ctx.lineTo(size - 4, size - 4)
  ctx.lineTo(hw, size - 9)
  ctx.lineTo(4, size - 4)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 1.8
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 3
  ctx.fill(); ctx.stroke()
  return c
}

// ─── Colored DOM arrow element for a route start marker ─────────────────────
function makeRouteArrowEl(color: string): HTMLDivElement {
  const el = document.createElement('div')
  el.innerHTML = `<svg viewBox="0 0 24 24" width="36" height="36" xmlns="http://www.w3.org/2000/svg"
    style="filter:drop-shadow(0 2px 8px rgba(0,0,0,.55)) drop-shadow(0 0 6px ${color});">
    <path d="M12 2L20 20L12 14L4 20Z" fill="${color}" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;'
  return el
}

// ─── Bearing between two lon/lat points ─────────────────────────────────────
function calcBearing(a: [number, number], b: [number, number]): number {
  return Math.atan2(b[0] - a[0], b[1] - a[1]) * (180 / Math.PI)
}

// ─── 3D buildings ────────────────────────────────────────────────────────────
function add3DBuildings(map: MLMap) {
  const layers = map.getStyle().layers || []
  if (layers.find((l: any) => l.type === 'fill-extrusion')) return
  try {
    if (!map.getSource('quantara-openfreemap')) map.addSource('quantara-openfreemap', { url: 'https://tiles.openfreemap.org/planet', type: 'vector' } as any)
    const lbl = layers.find((l: any) => l.type === 'symbol' && l.layout?.['text-field'])?.id
    map.addLayer({ id: 'quantara-3d-buildings', source: 'quantara-openfreemap', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 11, filter: ['!=', ['get', 'hide_3d'], true], paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'render_height'], 0, '#263449', 40, '#355d7d', 180, '#557fa2'], 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, ['*', ['coalesce', ['get', 'render_height'], 8], 0.65], 15, ['coalesce', ['get', 'render_height'], 8]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.86 } }, lbl)
  } catch {}
}

function makeLineFeatureCollection(coords: [number, number][], properties: any = {}): any {
  if (!coords || coords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties,
        geometry: {
          type: 'LineString',
          coordinates: coords
        }
      }
    ]
  };
}

// ─── Route line layers only (NO symbol/arrow layers) ─────────────────────────
// Map layers will be ensured inside the component now

// ─── Component ───────────────────────────────────────────────────────────────
export default function QRouteMap({
  height = '100%', origin, destination, waypoints = [], routeGeometry, multiRoutes,
  focus, pitch3d = true, vehicles = [], incidents = [], autoTheme = true,
  showControls = true, fitRoute = true, onMapClick, onIncidentDoubleClick,
  intelligenceEvents, steps, activeStep
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const markersRef = useRef<Marker[]>([])          // stop / incident / vehicle markers
  const routeArrowsRef = useRef<Marker[]>([])      // one static arrow per route
  const stepMarkersRef = useRef<Marker[]>([])
  const [ready, setReady] = useState(false)
  const [styleKey, setStyleKey] = useState(0)
  const [manualNight, setManualNight] = useState<boolean | null>(null)
  const [night, setNight] = useState(() => { const h = new Date().getHours(); return h >= 19 || h < 6 })

  // Auto-theme
  useEffect(() => {
    if (!autoTheme || manualNight !== null) return
    const fn = () => { const h = new Date().getHours(); setNight(h >= 19 || h < 6) }
    fn(); const t = setInterval(fn, 60000); return () => clearInterval(t)
  }, [autoTheme, manualNight])

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail || {}; if (d.type === 'SET_MAP_MODE') setManualNight(d.mode === 'night' ? true : d.mode === 'day' ? false : null) }
    window.addEventListener('quantara:friday-action', h); return () => window.removeEventListener('quantara:friday-action', h)
  }, [])
  useEffect(() => { if (manualNight !== null) setNight(manualNight) }, [manualNight])

  // Apply route GeoJSON data to sources
  const applyRouteData = useCallback((map: MLMap) => {
    if (!map.isStyleLoaded()) return

    const coords: [number, number][] = (routeGeometry || [])
      .map((p: any) => [typeof p.lon === 'number' ? p.lon : p.lng, p.lat])
      .filter((c: any) => typeof c[0] === 'number' && typeof c[1] === 'number' && !isNaN(c[0]) && !isNaN(c[1])) as [number, number][]

    const routeSource = map.getSource('quantara-route') as maplibregl.GeoJSONSource | undefined
    if (routeSource) {
      routeSource.setData(makeLineFeatureCollection(coords))
    }

    if (multiRoutes && multiRoutes.length > 0) {
      multiRoutes.forEach((mr, i) => {
        if (i >= 15) return
        const c: [number, number][] = (mr.geometry || [])
          .map((p: any) => [typeof p.lon === 'number' ? p.lon : p.lng, p.lat])
          .filter((pt: any) => typeof pt[0] === 'number' && typeof pt[1] === 'number') as [number, number][]
        const s = map.getSource(`quantara-multi-${i}`) as maplibregl.GeoJSONSource | undefined
        if (s) s.setData(makeLineFeatureCollection(c, { color: mr.color }))
      })
      for (let i = multiRoutes.length; i < 15; i++) {
        const s = map.getSource(`quantara-multi-${i}`) as maplibregl.GeoJSONSource | undefined
        if (s) s.setData(makeLineFeatureCollection([]))
      }
    }

    if (fitRoute && coords.length >= 2) {
      const b = new LngLatBounds()
      coords.forEach(c => b.extend(c))
      map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 80 }, duration: 900, maxZoom: 16 })
    }
  }, [routeGeometry, multiRoutes, fitRoute])

  const ensureMapLayers = useCallback((map: MLMap) => {
    if (!map.isStyleLoaded()) return

    const coords: [number, number][] = (routeGeometry || [])
      .map((p: any) => [typeof p.lon === 'number' ? p.lon : p.lng, p.lat])
      .filter((c: any) => typeof c[0] === 'number' && typeof c[1] === 'number' && !isNaN(c[0]) && !isNaN(c[1])) as [number, number][]

    const data = makeLineFeatureCollection(coords)

    if (!map.getSource('quantara-route')) {
      map.addSource('quantara-route', { type: 'geojson', data })
    } else {
      (map.getSource('quantara-route') as maplibregl.GeoJSONSource).setData(data)
    }

    if (!map.getLayer('quantara-route-glow')) {
      try {
        map.addLayer({
          id: 'quantara-route-glow',
          type: 'line',
          source: 'quantara-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#06b6d4',
            'line-width': 14,
            'line-opacity': 0.45,
            'line-blur': 4
          }
        })
      } catch (e) {}
    }

    if (!map.getLayer('quantara-route-line')) {
      try {
        map.addLayer({
          id: 'quantara-route-line',
          type: 'line',
          source: 'quantara-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#00f0ff',
            'line-width': 6,
            'line-opacity': 1.0
          }
        })
      } catch (e) {}
    }

    for (let i = 0; i < 15; i++) {
      const sid = `quantara-multi-${i}`
      const mr = multiRoutes && i < multiRoutes.length ? multiRoutes[i] : null
      const c: [number, number][] = mr ? (mr.geometry || []).map((p: any) => [typeof p.lon === 'number' ? p.lon : p.lng, p.lat]).filter((pt: any) => typeof pt[0] === 'number' && typeof pt[1] === 'number') as [number, number][] : []
      const mData = makeLineFeatureCollection(c, { color: mr ? mr.color : 'rgba(0,0,0,0)' })

      if (!map.getSource(sid)) {
        map.addSource(sid, { type: 'geojson', data: mData })
      } else {
        (map.getSource(sid) as maplibregl.GeoJSONSource).setData(mData)
      }

      if (!map.getLayer(`${sid}-glow`)) {
        try {
          map.addLayer({
            id: `${sid}-glow`,
            type: 'line',
            source: sid,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 12, 'line-opacity': 0.25, 'line-blur': 4 }
          })
        } catch (e) {}
      }

      if (!map.getLayer(`${sid}-line`)) {
        try {
          map.addLayer({
            id: `${sid}-line`,
            type: 'line',
            source: sid,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 4.5, 'line-opacity': 0.96 }
          })
        } catch (e) {}
      }
    }

    applyRouteData(map)
  }, [routeGeometry, multiRoutes, applyRouteData])

  // Place ONE static vehicle arrow on the MAIN routeGeometry (~85% along) to simulate a vehicle en route
  useEffect(() => {
    try {
      const map = mapRef.current
      if (!map || !ready) return

      // Remove all existing route arrows
      routeArrowsRef.current.forEach(m => { try { m.remove() } catch {} })
      routeArrowsRef.current = []

      if (!routeGeometry || !Array.isArray(routeGeometry) || routeGeometry.length < 2) return

      // Place at ~85% along the highlighted route (near the destination point)
      const idx = Math.max(1, Math.floor(routeGeometry.length * 0.85))
      const pt = routeGeometry[idx]
      const nextPt = routeGeometry[Math.min(idx + 1, routeGeometry.length - 1)]
      
      const ptLon = typeof pt?.lon === 'number' ? pt.lon : (pt as any)?.lng
      const nextPtLon = typeof nextPt?.lon === 'number' ? nextPt.lon : (nextPt as any)?.lng
      if (typeof ptLon !== 'number' || typeof pt?.lat !== 'number' || typeof nextPtLon !== 'number' || typeof nextPt?.lat !== 'number') return

      const heading = calcBearing([ptLon, pt.lat], [nextPtLon, nextPt.lat])

      const el = document.createElement('div')
      // Use a cyan arrow to match the theme
      el.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 10px rgba(0,0,0,.5));"><path d="M12 2L19 20L12 15L5 20Z" fill="#22d3ee" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`
      el.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;'
      
      const marker = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([ptLon, pt.lat])
      marker.setRotation(heading || 0)
      marker.addTo(map)
      routeArrowsRef.current.push(marker)
    } catch (e) {
      console.error('Failed to place vehicle arrow:', e)
    }
  }, [routeGeometry, ready, styleKey])

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const initCity = localStorage.getItem('quantara_city') || 'Pune';
    const initialCoords: Record<string, [number, number]> = { 'Pune': [73.8567, 18.5204], 'Jaipur': [75.7873, 26.9124], 'Delhi': [77.2090, 28.6139], 'Bangalore': [77.5946, 12.9716], 'Mumbai': [72.8777, 19.0760], 'Hyderabad': [78.4867, 17.3850], 'Chennai': [80.2707, 13.0827], 'Kolkata': [88.3639, 22.5726], 'Ahmedabad': [72.5714, 23.0225], 'Nagpur': [79.0882, 21.1458], 'Nashik': [73.7898, 19.9975] };
    const center = initialCoords[initCity] || [73.8567, 18.5204];
    const map = new maplibregl.Map({ container: containerRef.current, style: night ? NIGHT_STYLE : DAY_STYLE, center, zoom: 12, pitch: pitch3d ? 58 : 0, bearing: pitch3d ? -12 : 0, maxPitch: 78, antialias: true, attributionControl: { compact: true } })
    if (showControls) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserLocation: true }), 'top-right')
    map.on('load', () => { add3DBuildings(map); setReady(true); setStyleKey(k => k + 1) })
    map.on('styledata', () => { if (!map.isStyleLoaded()) return; add3DBuildings(map); setStyleKey(k => k + 1) })
    if (onMapClick) map.on('click', e => onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Day/Night switch
  useEffect(() => { const map = mapRef.current; if (!map) return; map.setStyle(night ? NIGHT_STYLE : DAY_STYLE) }, [night])

  // Re-apply route lines after style reloads or props change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      ensureMapLayers(map);
    } else {
      map.once('styledata', () => ensureMapLayers(map));
    }
  }, [ensureMapLayers, styleKey])



  // Focus / fly-to
  useEffect(() => {
    if (!focus || !mapRef.current) return
    if (focus.bounds) { mapRef.current.fitBounds(focus.bounds, { padding: 80, duration: 1200, maxZoom: 16 }) }
    else if (focus.lat !== undefined && (focus.lon !== undefined || (focus as any).lng !== undefined)) {
      const fLon = focus.lon !== undefined ? focus.lon : (focus as any).lng
      mapRef.current.flyTo({ center: [fLon, focus.lat], zoom: focus.zoom ?? 16, pitch: 62, bearing: -20, essential: true, duration: 900 })
    }
  }, [focus])

  // City change event
  useEffect(() => {
    const h = (e: Event) => { const city = (e as CustomEvent).detail?.city; if (!city || !mapRef.current) return; const coords: Record<string, [number, number]> = { 'Pune': [73.8567, 18.5204], 'Jaipur': [75.7873, 26.9124], 'Delhi': [77.2090, 28.6139], 'Bangalore': [77.5946, 12.9716], 'Mumbai': [72.8777, 19.0760], 'Hyderabad': [78.4867, 17.3850], 'Chennai': [80.2707, 13.0827], 'Kolkata': [88.3639, 22.5726], 'Ahmedabad': [72.5714, 23.0225], 'Nagpur': [79.0882, 21.1458], 'Nashik': [73.7898, 19.9975] }; if (coords[city]) mapRef.current.flyTo({ center: coords[city], zoom: 12, pitch: 45, duration: 2000, essential: true }) }
    window.addEventListener('quantara:city-change', h); return () => window.removeEventListener('quantara:city-change', h)
  }, [])

  // DOM markers — stops, incidents, GPS vehicles
  useEffect(() => {
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return

    markersRef.current.filter(m => !(m as any)._isVehicle).forEach(m => m.remove())
    markersRef.current = markersRef.current.filter(m => (m as any)._isVehicle)

    const dot = (p: IncidentMarker, color: string, label: string, html?: string, size = 18, border = '2px solid #fff') => {
      const pLon = typeof p?.lon === 'number' ? p.lon : (p as any)?.lng
      if (typeof pLon !== 'number' || typeof p?.lat !== 'number' || isNaN(pLon) || isNaN(p.lat)) return
      const el = document.createElement('div')
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};box-shadow:0 0 18px ${color};cursor:pointer;`
      if (p.id && onIncidentDoubleClick) el.addEventListener('dblclick', e => { e.stopPropagation(); onIncidentDoubleClick(p.id as string) })
      markersRef.current.push(new Marker({ element: el }).setLngLat([pLon, p.lat]).setPopup(new Popup({ offset: 12 }).setHTML(html || `<b>${label}</b><br/>${p.label || ''}`)).addTo(map))
    }

    const diamond = (p: IncidentMarker, color: string, label: string, html?: string, size = 18, border = '2px solid #fff') => {
      const pLon = typeof p?.lon === 'number' ? p.lon : (p as any)?.lng
      if (typeof pLon !== 'number' || typeof p?.lat !== 'number' || isNaN(pLon) || isNaN(p.lat)) return
      const el = document.createElement('div')
      el.style.cssText = `width:${size}px;height:${size}px;background:${color};border:${border};box-shadow:0 0 18px ${color};cursor:pointer;transform:rotate(45deg);`
      const inner = document.createElement('div')
      inner.style.cssText = 'width:100%;height:100%;transform:rotate(-45deg);'
      el.appendChild(inner) // inner div to counter-rotate children if needed, though popup attaches to marker not element content visually.
      if (p.id && onIncidentDoubleClick) el.addEventListener('dblclick', e => { e.stopPropagation(); onIncidentDoubleClick(p.id as string) })
      markersRef.current.push(new Marker({ element: el }).setLngLat([pLon, p.lat]).setPopup(new Popup({ offset: 12 }).setHTML(html || `<b>${label}</b><br/>${p.label || ''}`)).addTo(map))
    }

    const arrowOrigin = (p: IncidentMarker, color: string, label: string, html?: string, size = 30) => {
      const pLon = typeof p?.lon === 'number' ? p.lon : (p as any)?.lng
      if (typeof pLon !== 'number' || typeof p?.lat !== 'number' || isNaN(pLon) || isNaN(p.lat)) return
      const el = document.createElement('div')
      el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 10px rgba(0,0,0,.5));"><path d="M12 2L19 20L12 15L5 20Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`
      el.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;`
      if (p.id && onIncidentDoubleClick) el.addEventListener('dblclick', e => { e.stopPropagation(); onIncidentDoubleClick(p.id as string) })
      markersRef.current.push(new Marker({ element: el }).setLngLat([pLon, p.lat]).setPopup(new Popup({ offset: 12 }).setHTML(html || `<b>${label}</b><br/>${p.label || ''}`)).addTo(map))
    }

    if (origin) arrowOrigin(origin, '#138808', 'Origin', `<b>ORIGIN (Vehicle Start)</b><br/>${origin.label || ''}`)
    waypoints.forEach((w, i) => diamond(w, '#ff9933', `Stop ${i + 1}`, `<b>STOP ${i + 1}</b><br/>${w.label || ''}`))
    if (destination) diamond(destination, '#ef4444', 'Destination', `<b>DESTINATION</b><br/>${destination.label || ''}`)

    incidents.filter(i => i.lat && i.lon).forEach(i => {
      let color = '#ef4444', border = '2px solid #fff'
      if (i.type === 'ROAD_CLOSURE') { color = '#D50000'; border = '2px dashed #fff' }
      else if (i.severity === 'HIGH' || i.severity === 'SEVERE' || i.type === 'RUSH_HOUR' || i.type === 'RANDOM_CONGESTION') color = '#FF9100'
      else if (i.severity === 'LOW' || i.type === 'NORMAL') color = '#00E676'
      dot(i, color, 'Incident', `<b>⚠ ${i.type ? i.type.replace('_', ' ') : 'INCIDENT'}</b><br/>${i.label || 'Affected road'}`, 22, border)
    })

    intelligenceEvents?.filter(e => e.location?.lat && e.location?.lon).forEach(e => {
      let color = '#ef4444', border = '2px solid #fff', icon = '⚠'
      if (e.category === 'WEATHER') { color = '#3b82f6'; icon = '☁'; }
      if (e.category === 'ROAD_CONDITION') { color = '#06b6d4'; icon = '🛣'; }
      if (e.category === 'CLOSURE') { color = '#ef4444'; border = '2px dashed #fff'; icon = '⛔'; }
      if (e.category === 'MAINTENANCE') { color = '#eab308'; icon = '🚧'; }
      if (e.category === 'CROWD') { color = '#a855f7'; icon = '👥'; }
      if (e.category === 'OBSTACLE') { color = '#f97316'; icon = '🌳'; }
      if (e.category === 'LANDSLIDE') { color = '#84cc16'; icon = '⛰'; }
      
      const el = document.createElement('div')
      el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};border:${border};box-shadow:0 0 12px ${color};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;color:white;`
      el.innerHTML = icon
      markersRef.current.push(new Marker({ element: el }).setLngLat([e.location.lon, e.location.lat]).setPopup(new Popup({ offset: 12 }).setHTML(`<b>${icon} ${e.type}</b><br/>Severity: ${e.severity}<br/>Status: ${e.status}`)).addTo(map))
    })

    // GPS-based fleet vehicle arrows
    vehicles.forEach(v => {
      const mr = multiRoutes?.find(r => r.vehicleId === v.id)
      const color = mr ? mr.color : (v.status === 'DELAYED' ? '#ff6b35' : v.status === 'OFFLINE' ? '#64748b' : '#22d3ee')
      
      let m = markersRef.current.find(m => (m as any)._vehicleId === v.id)
      if (!m) {
        const el = document.createElement('div')
        el.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 10px rgba(0,0,0,.5));"><path class="vehicle-arrow-path" d="M12 2L19 20L12 15L5 20Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>`
        el.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:pointer;'
        m = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([v.lon, v.lat]).addTo(map)
        ;(m as any)._vehicleId = v.id; (m as any)._isVehicle = true
        markersRef.current.push(m)
      }
      const path = (m as any).getElement?.()?.querySelector('.vehicle-arrow-path')
      if (path) path.setAttribute('fill', color)
      m.setLngLat([v.lon, v.lat]); m.setRotation(v.heading || 0)
      m.setPopup(new Popup({ offset: 18 }).setHTML(`<b>${v.id}</b><br/>${v.status.replace('_', ' ')} · ${v.speed} km/h<br/>ETA ${v.eta}<br/>${v.deliveries} deliveries`))
    })

    const liveIds = new Set(vehicles.map(v => v.id))
    markersRef.current = markersRef.current.filter(m => {
      if ((m as any)._isVehicle && !liveIds.has((m as any)._vehicleId)) { m.remove(); return false }
      return true
    })
  }, [origin, destination, waypoints, vehicles, incidents, ready, night])

  // Turn-by-turn maneuver markers
  useEffect(() => {
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    stepMarkersRef.current.forEach(m => m.remove()); stepMarkersRef.current = []
    ;(steps || []).forEach(st => {
      const active = activeStep === st.index
      const el = document.createElement('div')
      const c = st.color || '#22d3ee'
      el.style.cssText = `width:${active ? 30 : 22}px;height:${active ? 30 : 22}px;border-radius:50%;background:${active ? '#fff' : 'rgba(5,8,16,.88)'};color:${active ? '#050810' : c};border:2px solid ${c};display:flex;align-items:center;justify-content:center;font:700 ${active ? 15 : 12}px/1 system-ui;box-shadow:0 0 ${active ? 16 : 6}px ${c};cursor:pointer;z-index:${active ? 5 : 1};`
      el.textContent = MANEUVER_GLYPH[st.maneuver] || '•'
      const popup = new Popup({ offset: 14 }).setHTML(`<b>Step ${st.index}</b><br/>${st.instruction}`)
      const mk = new Marker({ element: el }).setLngLat([st.lon, st.lat]).setPopup(popup).addTo(map)
      if (active) mk.togglePopup()
      stepMarkersRef.current.push(mk)
    })
    return () => { stepMarkersRef.current.forEach(m => m.remove()); stepMarkersRef.current = [] }
  }, [steps, activeStep, ready, night])
  useEffect(() => {
    const map = mapRef.current; if (!map || activeStep == null) return
    const st = (steps || []).find(x => x.index === activeStep); if (st) map.flyTo({ center: [st.lon, st.lat], zoom: Math.max(map.getZoom(), 15), duration: 700, essential: true })
  }, [activeStep])

  return <div ref={containerRef} style={{ height }} className="w-full h-full" />
}
