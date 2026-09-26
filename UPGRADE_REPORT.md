# QUANTARA v3.2 — Live Operations Upgrade

## Fixed
- Location selections now fetch real road geometry through TomTom -> OSRM -> internal road graph. No straight-line route is used when a road path is available.
- Multi-stop routing endpoint added at `POST /api/routes/calculate-through`.
- Plan & Optimize auto-previews the road route and has Start/Stop Mission controls.
- Active mission refreshes the route every 15 seconds so new traffic/incident state can change the route.
- Population/iteration controls normalize values to integers and clamp to valid ranges, preventing `01`, `02`, `0999` style entry artifacts.
- Optimization convergence labels start at iteration 1.
- 3D map buildings render at city zoom levels; route lines are rounded and fit to the road path.
- Admin incident points have real coordinates and are broadcast to connected clients. Admin accidents/closures affect the internal graph and appear on citizen maps.
- Traffic incidents merge live TomTom incidents with admin-created incidents.
- Admin-only operations are enforced on the backend, not just hidden in the UI.
- Citizen and admin dashboards now have separate purposes and navigation.

## Admin
- Full control-room dashboard: fleet, live GPS, traffic, weather, optimization intelligence, incident editor, scenario controls, user/system status.
- Click the map to place an incident, choose type/severity, and publish it.
- Incident updates are visible to citizen delivery maps.

## Citizen
- Basic pickup/destination/package/vehicle information only.
- Live road route and ETA preview.
- Delivery tracking view.
- No optimization, benchmarking, traffic simulation, incident editing or admin controls.

## FRIDAY
- Rule-based operational commands are retained.
- Groq is used for natural-language tool resolution and live-context answers when configured.
- Navigation/action results now execute in the UI.
- Added start/stop mission and reroute-all-delayed actions.
- Added admin voice incident command such as `report an accident at Baner` (confirmation required).
- TTS provider selection respects `TTS_PROVIDER`; Chatterbox can be primary when `CHATTERBOX_TTS_URL` is configured, with cloud/browser fallback.
- Live context includes fleet, traffic, recent conversation and admin incidents.

## Live vehicle tracking
- Existing Where-Is-My-Train-style route-progress + nearest-road matching + speed smoothing tracker remains active.
- Real devices can replace simulation through `POST /api/fleet/:id/gps`.
- GPS responses include road match, confidence, progress, ETA and source.
