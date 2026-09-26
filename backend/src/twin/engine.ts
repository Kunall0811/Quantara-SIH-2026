/**
 * QUANTARA Transportation Digital Twin.
 *
 * One stateful object holds the live network (the shared RoadGraph), the fleet, the deliveries, the
 * weather, the event log and every plan produced. All mutations go through `applyEvent`, all planning
 * goes through `optimize` → the algorithm registry, so the chain
 *   Digital Twin → Graph → Optimization → Route → Fleet → UI
 * is one real code path (no UI-side numbers).
 */
import { getGraph, resetGraph, triggerSimulation, WEATHER_MODEL, currentWeather, reseedDrift } from '../services/graphService';
import { RoadGraph } from '../optimization/graph';
import { DEFAULT_WEIGHTS, FitnessWeights, VehicleProfileLite, Customer, WeatherContext, VrpEvaluation } from '../optimization/fitness';
import { generateDataset } from '../optimization/datasetGenerator';
import { runAlgorithm, RunParams } from '../optimization';
import { evaluateFixedPlan } from '../optimization/waypointOrder';
import { RouteOracle } from '../optimization/routeOracle';
import { Delivery, OpsVehicle, EventRequest, TwinEvent, Plan, PlanRoute, specOf, TWIN_EVENT_TYPES, WeatherCondition } from './types';
import { baseId } from './roadCodes';
import { mutateNetwork } from './mutate';
import { buildPlan, planTotals, resetPlanCounter } from './plan';
import { diffPlans, PlanDiff, effectiveDelayMin } from './diff';
import { buildSteps, graphGeometry } from './directions';
import { setVehicleOffline } from '../services/fleetTracker';
import { recordObservation } from '../learning/actualVsPredicted';
import { appendJsonl } from '../services/persistence';
import { env } from '../config/env';
import { getStore } from '../store';
import { getIo } from '../socket';

export interface LoadOptions { customers?: number; vehicles?: number; seed?: number; depotId?: string; startTimeMin?: number; label?: string }
export interface OptimizeOptions { pin?: Map<string, string>; algorithm?: string; populationSize?: number; maxIterations?: number; seed?: number; onProgress?: RunParams['onProgress']; snapshot?: boolean }

export interface Impact {
  affectedVehicles: string[]; affectedDeliveries: string[];
  reasons: Record<string, string>;
  staleTotals: Plan['totals'] & { unassigned: number; effectiveDelayMin: number };
  baselineTotals: Plan['totals'];
}

const FUEL_CYCLE: Pick<VehicleProfileLite, 'fuelType' | 'fuelEfficiencyKmPerL'>[] = [
  { fuelType: 'diesel', fuelEfficiencyKmPerL: 14 }, { fuelType: 'cng', fuelEfficiencyKmPerL: 20 },
  { fuelType: 'electric', fuelEfficiencyKmPerL: 7 }, { fuelType: 'petrol', fuelEfficiencyKmPerL: 15 },
];

export class TwinEngine {
  version = 0;
  depotId = 'pune-hub';
  datasetLabel = 'unloaded';
  seed = 42;
  startTimeMin = 540;                       // 09:00
  weights: FitnessWeights = { ...DEFAULT_WEIGHTS };
  deliveries: Delivery[] = [];
  fleet: OpsVehicle[] = [];
  events: TwinEvent[] = [];
  plans: Plan[] = [];
  currentPlanId: string | null = null;
  loaded = false;
  /** vehicles whose routes were hit by events since the last plan (drives minimal-disruption re-planning) */
  affectedSincePlan = new Set<string>();
  lastReoptimization: ReturnType<TwinEngine['reoptimize']> | null = null;

  get graph(): RoadGraph { return getGraph(); }
  get currentPlan(): Plan | null { return this.plans.find((p) => p.id === this.currentPlanId) ?? null; }
  getPlan(id: string) { return this.plans.find((p) => p.id === id) ?? null; }

  weather(): WeatherContext {
    const m = WEATHER_MODEL[currentWeather.condition] ?? WEATHER_MODEL['Clear Sky'];
    return { rainMm: m.rainMmPerH, weatherSeverity: m.severity };
  }

  // ── loading ────────────────────────────────────────────────────────────
  load(opts: LoadOptions = {}) {
    resetGraph(); reseedDrift(opts.seed ?? 42); resetPlanCounter();
    const g = this.graph;
    this.seed = opts.seed ?? 42;
    this.depotId = opts.depotId ?? 'pune-hub';
    if (!g.nodes.has(this.depotId)) throw new Error(`Unknown depot node: ${this.depotId}`);
    this.startTimeMin = opts.startTimeMin ?? 540;
    const nC = Math.max(1, Math.min(200, opts.customers ?? 12)), nV = Math.max(1, Math.min(20, opts.vehicles ?? 4));
    const ds = generateDataset(this.seed, nC, nV, g, this.depotId, { startTimeMin: this.startTimeMin, capacityHeadroom: 1.6 });
    this.deliveries = ds.customers.map((c, i) => {
      const n = g.nodes.get(c.nodeId!)!;
      const priority = i % 9 === 4 ? 'emergency' : i % 4 === 2 ? 'high' : 'normal';
      return { id: c.id, label: n.name ?? c.nodeId!, lat: n.lat, lon: n.lon, nodeId: c.nodeId!, demand: c.demand, windowStart: c.readyTime, windowEnd: c.dueTime, serviceMin: c.serviceTime, priority, status: 'PENDING' } as Delivery;
    });
    this.fleet = ds.fleet.map((v, i) => ({
      id: v.id!, name: `QUANTARA-${String(i + 1).padStart(2, '0')}`, capacity: v.capacity ?? 20,
      ...FUEL_CYCLE[i % FUEL_CYCLE.length], priority: 'normal', available: true, status: 'ACTIVE',
    }));
    this.fleet.forEach((v) => setVehicleOffline(v.id, false));
    this.events = []; this.plans = []; this.currentPlanId = null; this.loaded = true; this.affectedSincePlan.clear(); this.lastReoptimization = null;
    this.datasetLabel = opts.label ?? `Pune demo · ${nC} deliveries · ${nV} vehicles · seed ${this.seed}`;
    this.version = 1;
    return this.snapshot();
  }

  ensureLoaded() { if (!this.loaded) this.load(); }

  pins: Map<string, string> | null = null;
  customers(): Customer[] {
    return this.deliveries.filter((d) => d.status !== 'COMPLETED' && d.status !== 'FAILED').map((d) => ({
      id: d.id, nodeId: d.nodeId, demand: d.demand, readyTime: d.windowStart, dueTime: d.windowEnd, serviceTime: d.serviceMin, priority: d.priority,
      pinnedVehicleId: this.pins?.get(d.id),
    }));
  }
  profiles(): VehicleProfileLite[] {
    return this.fleet.map((v) => ({ id: v.id, fuelType: v.fuelType, fuelEfficiencyKmPerL: v.fuelEfficiencyKmPerL, priority: v.priority, capacity: v.capacity, available: v.available }));
  }

  runParams(o: OptimizeOptions = {}, graph: RoadGraph = this.graph, oracle?: RouteOracle): RunParams {
    return {
      graph, depotId: this.depotId, customers: this.customers(), fleet: this.profiles(), weights: this.weights, weather: this.weather(),
      populationSize: o.populationSize ?? 30, maxIterations: o.maxIterations ?? 100, seed: o.seed ?? this.seed, startTimeMin: this.startTimeMin,
      oracle, onProgress: o.onProgress,
    };
  }

  // ── planning ───────────────────────────────────────────────────────────
  optimize(o: OptimizeOptions = {}): Plan {
    this.ensureLoaded();
    this.pins = o.pin ?? null;
    const params = this.runParams(o);
    this.pins = null;
    if (!params.customers!.length) throw new Error('No pending deliveries to optimize.');
    const result = runAlgorithm(o.algorithm ?? 'QPSO', params);
    const scenario = this.events.length ? `AFTER ${this.events.length} EVENT(S): ${this.events.map((e) => e.request.type).join(', ')}` : 'NORMAL';
    const plan = buildPlan({
      result, graph: this.graph, deliveries: this.deliveries, fleet: this.fleet, customers: params.customers!, profiles: params.fleet!, depotId: this.depotId,
      weights: this.weights, startTimeMin: this.startTimeMin, datasetLabel: this.datasetLabel, twinVersion: this.version, scenario,
    });
    this.plans.push(plan); if (this.plans.length > 60) this.plans.shift();
    this.affectedSincePlan.clear();
    this.currentPlanId = plan.id;
    const assigned = new Set(plan.routes.flatMap((r) => r.stops.map((s) => s.deliveryId)));
    this.deliveries.forEach((d) => { if (d.status === 'PENDING' || d.status === 'ASSIGNED') d.status = assigned.has(d.id) ? 'ASSIGNED' : 'PENDING'; });
    getIo()?.emit('twin_plan', { planId: plan.id, algorithm: plan.algorithm, fitness: plan.fitness });
    return plan;
  }

  /** Re-simulate a committed plan on the *current* network — no re-assignment, no re-routing. */
  evaluatePlanNow(plan: Plan, graph: RoadGraph = this.graph): VrpEvaluation {
    const spec: Record<string, string[]> = {};
    specOf(plan).routes.forEach((r) => { spec[r.vehicleId] = r.deliveryIds; });
    return evaluateFixedPlan(spec, graph, this.depotId, this.customers(), this.profiles(), this.weights, this.weather(), 'dijkstra', this.startTimeMin);
  }

  private staleSummary(ev: VrpEvaluation) {
    const totals = planTotals(ev.routes);
    return { ...totals, unassigned: ev.unassigned.length, effectiveDelayMin: effectiveDelayMin(totals, ev.unassigned.length) };
  }

  // ── events ─────────────────────────────────────────────────────────────
  async applyEvent(req: EventRequest): Promise<{ event: TwinEvent; impact: Impact | null }> {
    this.ensureLoaded();
    if (!TWIN_EVENT_TYPES.includes(req.type)) throw new Error(`Unknown event type: ${req.type}`);
    const g = this.graph; const cur = this.currentPlan;
    const before = cur ? this.evaluatePlanNow(cur) : null;
    let location: { lat: number; lon: number } | undefined;
    let affectedEdges: string[] = []; let affectedVehicles: string[] = []; let networkWide = false; let description = '';
    const mostUsedEdge = () => {
      if (!cur) return null; const use = new Map<string, number>();
      cur.routes.forEach((r) => r.edgePath.forEach((e) => use.set(baseId(e), (use.get(baseId(e)) ?? 0) + 1)));
      const best = [...use.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return best ? best[0] : null;
    };

    switch (req.type) {
      case 'ROAD_CLOSURE': case 'ACCIDENT': case 'TRAFFIC_INCREASE': {
        const m = mutateNetwork(g, req, req.type === 'TRAFFIC_INCREASE' ? undefined : mostUsedEdge());
        affectedEdges = m.edges; networkWide = m.networkWide; description = m.description;
        if (m.roadBase) {
          const n = g.nodes.get(g.edges.get(m.roadBase)!.u);
          if (n) location = { lat: n.lat, lon: n.lon };
          try {
            await getStore().createIncident({ type: req.type, lat: n?.lat ?? 18.52, lon: n?.lon ?? 73.85, severity: 'HIGH', description, provider: 'admin-console', edgeId: m.roadBase, closedEdge: !!m.closed });
          } catch { /* incident marker is a nicety; twin state is already updated */ }
        }
        break;
      }
      case 'VEHICLE_BREAKDOWN': case 'VEHICLE_UNAVAILABLE': {
        let vid = req.vehicleId;
        if (!vid) { const busiest = cur?.routes.slice().sort((a, b) => b.stops.length - a.stops.length || a.vehicleId.localeCompare(b.vehicleId))[0]; vid = busiest?.vehicleId ?? this.fleet.find((v) => v.available)?.id; }
        const v = this.fleet.find((x) => x.id === vid || x.name === vid);
        if (!v) throw new Error(`Unknown vehicle: "${vid}".`);
        if (!this.fleet.some((x) => x.available && x.id !== v.id)) throw new Error('Refusing to disable the last available vehicle.');
        this.affectedSincePlan.add(v.id);
        v.available = false; v.status = req.type === 'VEHICLE_BREAKDOWN' ? 'BROKEN_DOWN' : 'UNAVAILABLE'; v.note = req.note ?? undefined;
        setVehicleOffline(v.id, true);
        affectedVehicles = [v.id];
        description = `${v.name} (${v.id}) ${req.type === 'VEHICLE_BREAKDOWN' ? 'broke down' : 'is unavailable'}${req.note ? `: ${req.note}` : ''}.`;
        break;
      }
      case 'WEATHER_CHANGE': {
        const c = (req.condition ?? 'Heavy Rain') as WeatherCondition;
        if (!(c in WEATHER_MODEL)) throw new Error(`Unknown weather condition: ${c}`);
        triggerSimulation(c); networkWide = true;
        description = `Weather → ${c}: network speed ×${WEATHER_MODEL[c].speed}, congestion +${Math.round(WEATHER_MODEL[c].congestionAdd * 100)}%.`;
        break;
      }
    }

    this.version++;
    const names = [...new Set(affectedEdges.map((id) => g.edges.get(id)?.name).filter(Boolean) as string[])];
    const event: TwinEvent = {
      id: `EVT-${String(this.events.length + 1).padStart(3, '0')}`, at: new Date().toISOString(), request: req, description,
      affectedEdgeIds: affectedEdges, affectedRoadNames: names, affectedVehicleIds: affectedVehicles, networkWide, location, twinVersion: this.version, source: 'SIMULATED',
    };
    this.events.push(event); appendJsonl('twin-events', event);

    let impact: Impact | null = null;
    if (cur && before) {
      const after = this.evaluatePlanNow(cur);
      const reasons: Record<string, string> = {}; const av = new Set<string>(); const ad = new Set<string>();
      const broken = new Set(affectedVehicles); const hit = new Set(affectedEdges);
      for (const r of cur.routes) {
        const b = before.routes.find((x) => x.vehicleId === r.vehicleId), a = after.routes.find((x) => x.vehicleId === r.vehicleId);
        if (broken.has(r.vehicleId)) { reasons[r.vehicleId] = 'vehicle unavailable — its deliveries have no driver'; av.add(r.vehicleId); r.stops.forEach((s) => ad.add(s.deliveryId)); continue; }
        const crosses = r.edgePath.some((e) => hit.has(e));
        const aTime = a?.totalTimeMin ?? 0, bTime = b?.totalTimeMin ?? 0;
        const dLate = (a?.latenessMin ?? 0) - (b?.latenessMin ?? 0);
        if (crosses || aTime - bTime > 1 || dLate > 0.5) {
          av.add(r.vehicleId);
          reasons[r.vehicleId] = crosses ? `route uses ${names[0] ?? 'an affected road'}${aTime - bTime > 0.5 ? ` (+${(aTime - bTime).toFixed(1)} min)` : ''}` : `+${(aTime - bTime).toFixed(1)} min on the committed route${dLate > 0.5 ? `, +${dLate.toFixed(0)} min late` : ''}`;
          const lateIds = new Set((a?.stopDetails ?? []).filter((s) => s.lateness > 0).map((s) => s.customerId));
          r.stops.forEach((s) => { if (crosses || lateIds.has(s.deliveryId)) ad.add(s.deliveryId); });
        }
      }
      after.unassigned.forEach((id) => ad.add(id));
      av.forEach((v) => this.affectedSincePlan.add(v));
      impact = { affectedVehicles: [...av], affectedDeliveries: [...ad], reasons, staleTotals: this.staleSummary(after), baselineTotals: cur.totals };
    }
    getIo()?.emit('twin_event', { id: event.id, type: req.type, description, twinVersion: this.version });
    getIo()?.emit('traffic_update', { changedEdges: affectedEdges.length });
    return { event, impact };
  }

  /** Undo every event: rebuild the network, restore the fleet, keep deliveries and plan history. */
  resetEvents() {
    const keep = this.plans;
    resetGraph(); reseedDrift(this.seed);
    this.fleet.forEach((v) => { v.available = true; v.status = 'ACTIVE'; v.note = undefined; setVehicleOffline(v.id, false); });
    this.events = []; this.version++; this.plans = keep;
  }

  // ── dynamic re-optimization ────────────────────────────────────────────
  reoptimize(o: OptimizeOptions & { reason?: string; mode?: 'FULL' | 'MINIMAL' } = {}) {
    this.ensureLoaded();
    const before = this.currentPlan;
    if (!before) throw new Error('No active plan to re-optimize. Run an optimization first.');
    const staleEval = this.evaluatePlanNow(before);
    const stale = this.staleSummary(staleEval);
    const t0 = performance.now();
    // MINIMAL (default): only deliveries on affected / unavailable vehicles may change vehicle; everything else keeps its driver.
    const mode = o.mode ?? 'MINIMAL';
    let pin: Map<string, string> | undefined;
    if (mode === 'MINIMAL' && this.affectedSincePlan.size) {
      pin = new Map();
      for (const r of before.routes) if (!this.affectedSincePlan.has(r.vehicleId) && this.fleet.find((v) => v.id === r.vehicleId)?.available) r.stops.forEach((s) => pin!.set(s.deliveryId, r.vehicleId));
    }
    const after = this.optimize({ ...o, algorithm: o.algorithm ?? 'AQPSO', pin });
    const reoptSeconds = (performance.now() - t0) / 1000;
    const diff = diffPlans(before, after);
    const afterDelay = effectiveDelayMin(after.totals, after.unassigned.length);
    const recentEvents = this.events.filter((e) => e.twinVersion > before.twinVersion);
    const counterfactual = {
      withoutReoptimization: stale,
      withReoptimization: { ...after.totals, unassigned: after.unassigned.length, effectiveDelayMin: afterDelay },
      delayAvoidedMin: stale.effectiveDelayMin - afterDelay,
      timeSavedMin: stale.totalTimeMin - after.totals.totalTimeMin,
      fuelSavedInr: stale.fuelCostInr - after.totals.fuelCostInr,
      co2SavedKg: stale.co2Kg - after.totals.co2Kg,
      deliveriesRecovered: stale.unassigned - after.unassigned.length,
    };
    const explanation = explainChange(before, after, diff, counterfactual, recentEvents, o.reason);
    const out = { mode: (pin ? 'MINIMAL' : 'FULL') as 'FULL' | 'MINIMAL', pinnedDeliveries: pin?.size ?? 0, before, after, diff, counterfactual, explanation, events: recentEvents, reoptimizeSeconds: reoptSeconds };
    this.lastReoptimization = out;
    return out;
  }

  // ── executing a plan / learning ────────────────────────────────────────
  /** Predicted (as planned) vs actual (plan re-simulated on the current network) — labelled SIMULATED_EXECUTION. */
  simulateExecution(planId?: string, record = true) {
    const plan = planId ? this.getPlan(planId) : this.currentPlan;
    if (!plan) throw new Error('No plan to execute.');
    const ev = this.evaluatePlanNow(plan);
    const rows: { vehicleId: string; deliveryId: string; predictedEtaMin: number; actualEtaMin: number; errorMin: number }[] = [];
    const hour = Math.floor(this.startTimeMin / 60);
    for (const r of ev.routes) {
      const pr = plan.routes.find((x) => x.vehicleId === r.vehicleId);
      for (const s of r.stopDetails) {
        const ps = pr?.stops.find((x) => x.deliveryId === s.customerId); if (!ps) continue;
        const predicted = ps.serviceStart - this.startTimeMin, actual = s.serviceStart - this.startTimeMin;
        rows.push({ vehicleId: r.vehicleId, deliveryId: s.customerId!, predictedEtaMin: predicted, actualEtaMin: actual, errorMin: actual - predicted });
        if (record) recordObservation({
          source: 'SIMULATED_EXECUTION', planId: plan.id, vehicleId: r.vehicleId, deliveryId: s.customerId, hourOfDay: hour, weather: currentWeather.condition,
          road: this.graph.edges.get(r.edgePath[0] ?? '')?.name, predictedEtaMin: predicted, actualEtaMin: actual,
          predictedDistanceKm: pr?.distanceKm, actualDistanceKm: r.distanceKm, predictedTraffic: pr ? avg(pr.edgePath.map((e) => baselineCongestion(e))) : undefined, observedTraffic: r.avgCongestion,
        });
      }
    }
    return { planId: plan.id, label: 'SIMULATED_EXECUTION' as const, rows, unassigned: ev.unassigned, totals: this.staleSummary(ev) };
  }

  snapshot() {
    const g = this.graph;
    const open = [...g.edges.values()].filter((e) => !e.id.endsWith('_r'));
    return {
      loaded: this.loaded, version: this.version, label: this.datasetLabel, seed: this.seed, depotId: this.depotId, startTimeMin: this.startTimeMin,
      network: { nodes: g.nodes.size, edges: open.length, closed: open.filter((e) => e.closed).length, weather: currentWeather.condition, speedFactor: g.globalSpeedFactor },
      fleet: this.fleet, deliveries: this.deliveries, events: this.events, currentPlanId: this.currentPlanId,
      plans: this.plans.map((p) => ({ id: p.id, algorithm: p.algorithm, fitness: p.fitness, dnaId: p.dnaId, createdAt: p.createdAt, scenario: p.scenario, twinVersion: p.twinVersion })),
      source: 'SIMULATED' as const,
      sources: { traffic: env.TRAFFIC_PROVIDER === 'tomtom' && env.TOMTOM_API_KEY ? 'LIVE+SIMULATED' : 'SIMULATED', geometry: env.ROUTING_OFFLINE ? 'FALLBACK' : 'LIVE-SNAPPED (falls back to FALLBACK)' },
    };
  }

  /** Optionally snap plan geometry to real roads (OSRM/TomTom) through the twin-chosen waypoints. Never throws. */
  async enrichGeometry(plan: Plan): Promise<Plan> {
    if (env.ROUTING_OFFLINE) return plan;
    try {
      const { osrmRoute } = await import('../providers/osrm');
      for (const r of plan.routes) {
        const pts = graphGeometry(this.graph, r.nodePath); if (pts.length < 2) continue;
        const step = Math.max(1, Math.ceil(pts.length / 40));
        const sampled = pts.filter((_, i) => i === 0 || i === pts.length - 1 || i % step === 0);
        const s = await osrmRoute(sampled);
        if (s && s.geometry.length >= 2) { r.geometry = s.geometry; r.geometrySource = 'LIVE'; }
      }
    } catch { /* keep graph geometry (FALLBACK) */ }
    return plan;
  }
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function baselineCongestion(_edgeId: string) { return 0.25; }   // documented prior: typical congestion assumed at planning time when no history exists

export function explainChange(before: Plan, after: Plan, diff: PlanDiff, cf: { delayAvoidedMin: number; timeSavedMin: number; deliveriesRecovered: number }, events: TwinEvent[], reason?: string): string[] {
  const out: string[] = [];
  if (events.length) out.push(`What changed: ${events.map((e) => e.description).join(' ')}`);
  else if (reason) out.push(`Trigger: ${reason}`);
  const f = (n: number, u: string, d = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)} ${u}`;
  out.push(`Old plan ${before.dnaId} → new plan ${after.dnaId} (${after.algorithm}, ${after.evaluations} objective evaluations).`);
  if (diff.reassigned.length) out.push(`${diff.reassigned.length} deliver${diff.reassigned.length === 1 ? 'y was' : 'ies were'} reassigned: ${diff.reassigned.slice(0, 6).map((r) => `${r.deliveryId} ${r.from ?? 'unassigned'}→${r.to ?? 'unassigned'}`).join(', ')}${diff.reassigned.length > 6 ? '…' : ''}.`);
  if (diff.changedRoutes.length) out.push(`Routes changed for ${diff.changedRoutes.map((c) => c.vehicleId).join(', ')}; unchanged: ${diff.unchangedRoutes.join(', ') || 'none'}.`);
  out.push(`Versus the old plan's numbers: time ${f(diff.delta.timeMin, 'min')}, distance ${f(diff.delta.distanceKm, 'km')}, fuel ${f(diff.delta.fuelCostInr, '₹', 0)}, CO₂ ${f(diff.delta.co2Kg, 'kg', 2)}, risk ${f(diff.delta.riskScore, 'pts', 3)}, lateness ${f(diff.delta.latenessMin, 'min')}.`);
  out.push(`Versus NOT re-optimizing (old plan run on the changed network): ${f(-cf.delayAvoidedMin, 'min delay')} (${cf.delayAvoidedMin >= 0 ? 'avoided' : 'added'}), ${f(-cf.timeSavedMin, 'min total time')}, ${cf.deliveriesRecovered} delivery(ies) recovered.`);
  if (after.unassigned.length) out.push(`⚠ ${after.unassigned.length} delivery(ies) cannot be served with the remaining fleet capacity: ${after.unassigned.join(', ')}.`);
  return out;
}

export const twin = new TwinEngine();
