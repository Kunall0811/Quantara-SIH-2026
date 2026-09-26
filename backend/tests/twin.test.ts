import { TwinEngine } from '../src/twin/engine';
import { simulateScenario, resilience, regret, timeWindowReport, explainPlan, stopRisk } from '../src/twin/analytics';
import { maneuverOf, turnAngle, bearingDeg, buildSteps } from '../src/twin/directions';
import { resolveRoad, roadCodeMap } from '../src/twin/roadCodes';
import { getGraph } from '../src/services/graphService';
import { summarize, clearObservations, MIN_SAMPLES, etaCorrection } from '../src/learning/actualVsPredicted';

jest.setTimeout(60000);

function freshTwin() { const t = new TwinEngine(); t.load({ customers: 10, vehicles: 3, seed: 42 }); return t; }

describe('digital twin core', () => {
  test('load builds deliveries + fleet on the Pune network, deterministically', () => {
    const a = freshTwin(), b = freshTwin();
    expect(a.deliveries.length).toBe(10); expect(a.fleet.length).toBe(3);
    expect(a.deliveries.map((d) => d.nodeId)).toEqual(b.deliveries.map((d) => d.nodeId));
    expect(a.deliveries.every((d) => d.nodeId.startsWith('pune-'))).toBe(true);
  });

  test('optimize produces a plan whose terms sum to fitness and whose stops cover all assigned deliveries', () => {
    const t = freshTwin(); const p = t.optimize({ algorithm: 'QPSO', maxIterations: 40 });
    expect(Object.values(p.terms).reduce((s, v) => s + v, 0)).toBeCloseTo(p.fitness, 6);
    const served = p.routes.flatMap((r) => r.stops.map((s) => s.deliveryId));
    expect(new Set(served).size).toBe(served.length);
    expect(served.length + p.unassigned.length).toBe(10);
    for (const r of p.routes) { expect(r.steps!.length).toBeGreaterThan(1); expect(r.steps![0].maneuver).toBe('depart'); expect(r.steps![r.steps!.length - 1].maneuver).toBe('arrive'); }
    expect(explainPlan(p).identity).toBe(true);
  });

  test('closing a road used by the plan changes the live graph and the re-optimized plan avoids it', async () => {
    const t = freshTwin(); const p = t.optimize({ algorithm: 'QPSO', maxIterations: 40 });
    const { event, impact } = await t.applyEvent({ type: 'ROAD_CLOSURE' });
    expect(event.affectedEdgeIds.length).toBeGreaterThan(0);
    event.affectedEdgeIds.forEach((id) => expect(t.graph.edges.get(id)!.closed).toBe(true));
    expect(impact!.affectedVehicles.length).toBeGreaterThan(0);
    const re = t.reoptimize({ algorithm: 'AQPSO', maxIterations: 40 });
    const used = new Set(re.after.routes.flatMap((r) => r.edgePath));
    event.affectedEdgeIds.forEach((id) => expect(used.has(id)).toBe(false));
    expect(re.before.id).toBe(p.id);
    expect(re.counterfactual.withoutReoptimization.effectiveDelayMin).toBeGreaterThanOrEqual(0);
    expect(re.explanation.join(' ')).toMatch(/closed/);
  });

  test('vehicle breakdown removes the vehicle from the new plan and reassigns its deliveries', async () => {
    const t = freshTwin(); const p = t.optimize({ algorithm: 'QPSO', maxIterations: 40 });
    const victim = p.routes.slice().sort((a, b) => b.stops.length - a.stops.length)[0];
    const { event } = await t.applyEvent({ type: 'VEHICLE_BREAKDOWN', vehicleId: victim.vehicleId });
    expect(event.affectedVehicleIds).toEqual([victim.vehicleId]);
    const re = t.reoptimize({ maxIterations: 40 });
    expect(re.after.routes.find((r) => r.vehicleId === victim.vehicleId)).toBeUndefined();
    const moved = re.diff.reassigned.filter((r) => r.from === victim.vehicleId);
    expect(moved.length).toBe(victim.stops.length - re.after.unassigned.filter((id) => victim.stops.some((s) => s.deliveryId === id)).length);
  });

  test('minimal-disruption re-planning: only the broken vehicle\'s deliveries change driver', async () => {
    const t = freshTwin(); const p = t.optimize({ maxIterations: 40 });
    const victim = p.routes.slice().sort((a, b) => b.stops.length - a.stops.length)[0].vehicleId;
    await t.applyEvent({ type: 'VEHICLE_BREAKDOWN', vehicleId: victim });
    const re = t.reoptimize({ maxIterations: 40 });
    expect(re.mode).toBe('MINIMAL');
    for (const m of re.diff.reassigned) expect(m.from).toBe(victim);
    const full = t.reoptimize({ maxIterations: 40, mode: 'FULL' });
    expect(full.mode).toBe('FULL');
  });

  test('refuses to disable the last vehicle and rejects unknown roads (negative tests)', async () => {
    const t = new TwinEngine(); t.load({ customers: 4, vehicles: 1, seed: 1 }); t.optimize({ maxIterations: 20 });
    await expect(t.applyEvent({ type: 'VEHICLE_BREAKDOWN' })).rejects.toThrow(/last available/);
    await expect(t.applyEvent({ type: 'ROAD_CLOSURE', road: 'Nonexistent Boulevard 9000' })).rejects.toThrow(/Unknown road/);
    await expect(t.applyEvent({ type: 'TRAFFIC_INCREASE', percent: -5 })).rejects.toThrow();
  });

  test('traffic +50% raises the committed plan travel time by roughly that factor and never mutates a clone-based dry run', async () => {
    const t = freshTwin(); const p = t.optimize({ maxIterations: 40 });
    const before = JSON.stringify([...t.graph.edges.values()].map((e) => [e.id, e.speedMultiplier, e.closed]));
    const out = simulateScenario(t, { name: 'T', requests: [{ type: 'TRAFFIC_INCREASE', percent: 50, scope: 'ALL' }] }, { maxIterations: 30 });
    expect(JSON.stringify([...t.graph.edges.values()].map((e) => [e.id, e.speedMultiplier, e.closed]))).toBe(before);   // live twin untouched
    const ratio = out.withoutReoptimization.durationMin / p.totals.durationMin;
    expect(ratio).toBeGreaterThan(1.35); expect(ratio).toBeLessThan(1.6);
    expect(out.label).toBe('SIMULATED');
  });
});

describe('resilience / regret / time windows', () => {
  test('resilience is computed from real scenario simulations with per-scenario evidence', () => {
    const t = freshTwin(); t.optimize({ maxIterations: 40 });
    const r = resilience(t, { maxIterations: 30 });
    expect(r.scenarios.map((s) => s.scenario)).toEqual(['NORMAL', 'ACCIDENT', 'ROAD_CLOSURE', 'HEAVY_TRAFFIC', 'RAIN', 'VEHICLE_FAILURE']);
    expect(r.scenarios[0].survived).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100);
    expect(r.scenarios.find((s) => s.scenario === 'RAIN')!.timeMin).toBeGreaterThan(r.scenarios[0].timeMin);
    expect(r.methodology).toMatch(/clone/);
  });

  test('regret is non-negative and hindsight re-optimization is one of the candidates', () => {
    const t = freshTwin(); t.optimize({ algorithm: 'PSO', maxIterations: 30 }); t.optimize({ algorithm: 'QPSO', maxIterations: 30 });
    const g = regret(t, { maxIterations: 30 });
    g.scenarios.forEach((s) => expect(s.regretMin).toBeGreaterThanOrEqual(0));
    expect(g.scenarios.length).toBe(5);
  });

  test('time-window report reads real stop timings', () => {
    const t = freshTwin(); const p = t.optimize({ maxIterations: 40 });
    const rep = timeWindowReport(p);
    expect(rep.stops.length).toBe(p.routes.reduce((s, r) => s + r.stops.length, 0));
    expect(stopRisk({ arrival: 0, serviceStart: 100, windowStart: 0, windowEnd: 102, lateness: 0 }).status).toBe('LIKELY VIOLATION');
    expect(stopRisk({ arrival: 0, serviceStart: 100, windowStart: 0, windowEnd: 110, lateness: 0 }).status).toBe('AT RISK');
    expect(stopRisk({ arrival: 0, serviceStart: 100, windowStart: 0, windowEnd: 200, lateness: 0 }).status).toBe('SAFE');
    expect(stopRisk({ arrival: 0, serviceStart: 100, windowStart: 0, windowEnd: 90, lateness: 10 }).status).toBe('VIOLATED');
  });
});

describe('directions & road codes', () => {
  test('bearing/turn classification', () => {
    expect(maneuverOf(0)).toBe('straight'); expect(maneuverOf(90)).toBe('right'); expect(maneuverOf(-90)).toBe('left');
    expect(maneuverOf(35)).toBe('slight-right'); expect(maneuverOf(-150)).toBe('sharp-left'); expect(maneuverOf(175)).toBe('uturn');
    expect(turnAngle(350, 10)).toBe(20); expect(turnAngle(10, 350)).toBe(-20);
    expect(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }))).toBe(0);
    expect(Math.round(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }))).toBe(90);
  });
  test('steps follow the evaluated path and end with arrive', () => {
    const g = getGraph(); const path = g.shortest('pune-hub', 'pune-n-kharadi', 'dijkstra', 'time');
    const steps = buildSteps(g, path.nodePath, path.edgePath);
    expect(steps[0].maneuver).toBe('depart'); expect(steps[steps.length - 1].maneuver).toBe('arrive');
    const km = steps.reduce((s, x) => s + x.distanceKm, 0);
    expect(km).toBeCloseTo(path.edgePath.reduce((s, e) => s + g.edges.get(e)!.distanceKm, 0), 1);
  });
  test('road codes resolve by code, id and name; both directions share a code', () => {
    const g = getGraph(); const codes = roadCodeMap(g); const [id, code] = [...codes.entries()][0];
    expect(resolveRoad(g, code)!.base).toBe(id); expect(resolveRoad(g, code.toLowerCase())!.base).toBe(id); expect(resolveRoad(g, id)!.ids.length).toBeGreaterThanOrEqual(1);
    expect(resolveRoad(g, 'Baner Road')!.name).toMatch(/Baner/i); expect(resolveRoad(g, 'zzzz-not-a-road')).toBeNull();
  });
});

describe('actual-vs-predicted learning', () => {
  beforeEach(() => clearObservations());
  test('honest about insufficient data, then aggregates once enough observations exist', () => {
    expect(summarize().status).toBe('NO_DATA');
    const t = freshTwin(); t.optimize({ maxIterations: 30 });
    t.simulateExecution();                             // baseline: no error
    const s1 = summarize();
    expect(['INSUFFICIENT_DATA', 'OK']).toContain(s1.status);
    if (s1.status === 'INSUFFICIENT_DATA') { expect(s1.message).toMatch(/Insufficient historical data/); expect((s1 as any).byVehicle).toEqual([]); }
  });
  test('after an incident the simulated execution shows real positive ETA error and a correction factor > 1', async () => {
    const t = freshTwin(); t.optimize({ maxIterations: 30 });
    await t.applyEvent({ type: 'WEATHER_CHANGE', condition: 'Heavy Rain' });
    for (let i = 0; i < 3; i++) t.simulateExecution();
    const s = summarize();
    expect(s.samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect((s as any).overall.biasMin).toBeGreaterThan(0);
    const c = etaCorrection(); expect(c.available).toBe(true); expect(c.factor).toBeGreaterThan(1);
  });
});
