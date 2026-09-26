/** Offline templated replies - always available, zero cost, used whenever Groq isn't configured or fails. */
export function templatedReply(tool: string, status: string, data: any): string {
  if (status === 'ERROR') return "I couldn't complete that. The required service is unavailable.";
  switch (tool) {
    case 'system.get_health':
      return `${data.activeIncidents ?? 0} active incidents, ${data.optimizationRuns ?? 0} optimization runs recorded, database: ${data.dbBackend}.`;
    case 'traffic.get_current_status':
      return `Average congestion is ${data.avgCongestionPct ?? 0}% across the monitored network (${data.source === 'LIVE' ? `live ${data.provider || 'traffic'} data` : 'live simulation state'}).`;
    case 'traffic.get_incidents':
      return `There are ${data.incidents?.length ?? 0} active incidents right now.`;
    case 'weather.get_current':
      return data.temperature !== null && data.temperature !== undefined
        ? `It's currently ${data.temperature}°C.` : 'Weather data is temporarily unavailable.';
    case 'routes.calculate':
      return `Route found via ${data.provider}: ${data.distanceKm} km, about ${Math.round(data.durationMinutes)} minutes.`;
    case 'incidents.create_incident':
      return "Done — I've triggered the scenario and updated the live traffic state.";
    case 'incidents.resolve_incident':
      return 'Understood, the incident has been resolved.';
    case 'analytics.get_statistics':
      return `${data.totalRuns ?? 0} optimization runs recorded so far.`;
    case 'fleet.list': { const vs = data.vehicles || []; const moving = vs.filter((v: any) => v.status === 'ON_ROUTE').length; const delayed = vs.filter((v: any) => v.status === 'DELAYED').length; return `${vs.length} vehicles are being tracked live: ${moving} on route and ${delayed} delayed.`; }
    case 'citizen.delivery_status': return "Your delivery is being tracked live. Please check the dashboard panel for your exact ETA and route progress.";
    case 'fleet.get_vehicle': { const v = data.vehicle; return v ? `${v.id} is ${v.status.toLowerCase().replace('_',' ')} on ${v.matchedRoad}, moving at ${v.speed} km/h with ETA ${v.eta}. Location confidence is ${v.confidencePct}%.` : data.error || 'Vehicle not found.'; }
    case 'fleet.assign_task': return data.error || `I have dispatched vehicle ${data.vehicleId} to the selected destination.`;
    case 'weather.simulate_weather': return `Weather simulation has been set to ${String(data.condition).replace('_', ' ').toLowerCase()}.`;
    case 'fleet.reroute_vehicle': return data.error || `I calculated a fresh route for ${data.vehicleId} using the current road network.`;
    case 'fleet.reroute_all_delayed': return `I recalculated routes for ${data.count ?? 0} delayed vehicles using the current road network.`;
    case 'map.set_mode': return `Map switched to ${data.action?.mode || 'automatic'} mode.`;
    case 'navigation.open': return `Opening ${data.action?.page || 'the requested page'}${data.action?.command ? ` and ${String(data.action.command).toLowerCase().replaceAll('_',' ')}.` : '.'}`;
    case 'optimization.run':
      return "Starting route optimization now. I'll update you when it's ready.";
    case 'optimization.benchmark':
      return 'Running the algorithm benchmark now.';
    case 'optimization.convergence':
      return "Here's the convergence chart for the latest optimization run.";
    default:
      return 'Done.';
  }
}
