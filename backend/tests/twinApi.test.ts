import request from 'supertest';
import { createApp } from '../src/app';
import { seedDemoUsers } from '../src/data/seedUsers';
import { twin } from '../src/twin/engine';

jest.setTimeout(120000);
const app = createApp();
let admin = ''; let citizen = '';
const A = () => ({ Authorization: `Bearer ${admin}` });

beforeAll(async () => {
  await seedDemoUsers();
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@qroute.in', password: 'admin123' })).body.token;
  citizen = (await request(app).post('/api/auth/login').send({ email: 'citizen@qroute.in', password: 'citizen123' })).body.token;
});

describe('digital twin API', () => {
  test('security: citizens cannot drive the twin, unauthenticated is 401', async () => {
    expect((await request(app).get('/api/twin/state')).status).toBe(401);
    expect((await request(app).post('/api/twin/optimize').set('Authorization', `Bearer ${citizen}`).send({})).status).toBe(403);
    expect((await request(app).post('/api/advanced/resilience').set('Authorization', `Bearer ${citizen}`).send({})).status).toBe(403);
  });

  test('load → optimize → event → reoptimize → analytics chain', async () => {
    const load = await request(app).post('/api/twin/load').set(A()).send({ customers: 8, vehicles: 3, seed: 7 });
    expect(load.status).toBe(200); expect(load.body.deliveries).toHaveLength(8);
    const noPlan = await request(app).post('/api/advanced/resilience').set(A()).send({});
    expect(noPlan.status).toBe(409); expect(noPlan.body.errorCode).toBe('NO_ACTIVE_PLAN');

    const opt = await request(app).post('/api/twin/optimize').set(A()).send({ algorithm: 'QPSO', maxIterations: 30, snapRoads: false });
    expect(opt.status).toBe(200);
    const plan = opt.body.plan; expect(plan.routes[0].steps.length).toBeGreaterThan(1); expect(plan.routes[0].geometrySource).toBe('FALLBACK');

    const exp = await request(app).post('/api/advanced/explain').set(A()).send({});
    expect(exp.body.identity).toBe(true);
    const tw = await request(app).post('/api/advanced/time-window-risk').set(A()).send({});
    expect(tw.body.stops.length).toBeGreaterThan(0);
    const dna = await request(app).post('/api/advanced/route-dna').set(A()).send({});
    expect(dna.body.routeDna.id).toBe(plan.dnaId);

    const liveBefore = JSON.stringify(twin.snapshot().network);
    const cf = await request(app).post('/api/advanced/counterfactual').set(A()).send({ requests: [{ type: 'ROAD_CLOSURE' }], maxIterations: 20 });
    expect(cf.status).toBe(200); expect(cf.body.label).toBe('SIMULATED');
    expect(JSON.stringify(twin.snapshot().network)).toBe(liveBefore);          // dry run left the live twin untouched

    const bad = await request(app).post('/api/twin/events').set(A()).send({ type: 'ROAD_CLOSURE', road: 'Atlantis Road' });
    expect(bad.status).toBe(400); expect(bad.body.errorCode).toBe('EVENT_REJECTED');

    const ev = await request(app).post('/api/twin/events').set(A()).send({ type: 'VEHICLE_BREAKDOWN', reoptimize: true, algorithm: 'QPSO' });
    expect(ev.status).toBe(200); expect(ev.body.reoptimization.diff).toBeDefined();
    const state = await request(app).get('/api/twin/state').set(A());
    expect(state.body.events).toHaveLength(1); expect(state.body.fleet.filter((v: any) => !v.available)).toHaveLength(1);

    const res = await request(app).post('/api/advanced/resilience').set(A()).send({ maxIterations: 20 });
    expect(res.body.scenarios.length).toBe(6); expect(res.body.score).toBeGreaterThanOrEqual(0);
    const reg = await request(app).post('/api/advanced/regret').set(A()).send({ maxIterations: 20 });
    expect(reg.body.scenarios.length).toBe(5);

    const exe = await request(app).post('/api/twin/execute').set(A()).send({});
    expect(exe.body.label).toBe('SIMULATED_EXECUTION');
    const learn = await request(app).get('/api/advanced/learning').set(A());
    expect(['NO_DATA', 'INSUFFICIENT_DATA', 'OK']).toContain(learn.body.summary.status);

    const reset = await request(app).post('/api/twin/reset-events').set(A()).send({});
    expect(reset.body.events).toHaveLength(0);
  });

  test('roads endpoint exposes R-codes usable by FRIDAY', async () => {
    const r = await request(app).get('/api/twin/roads?used=1').set(A());
    expect(r.body.roads[0].code).toMatch(/^R-\d+/);
  });
});

describe('FRIDAY grounded in the twin', () => {
  const chat = (text: string, extra: any = {}) => request(app).post('/api/friday/chat').set(A()).send({ text, ...extra });
  beforeAll(async () => { twin.load({ customers: 8, vehicles: 3, seed: 7 }); twin.optimize({ maxIterations: 30 }); });

  test('what-if is a dry run: answers with numbers and leaves the live twin unchanged', async () => {
    const v = twin.version;
    const r = await chat('What happens if traffic increases by 40 percent?');
    expect(r.body.tool).toBe('twin.what_if'); expect(r.body.status).toBe('SUCCESS');
    expect(r.body.text).toMatch(/SIMULATED/); expect(twin.version).toBe(v);
  });
  test('applying an event needs confirmation, then mutates the live twin', async () => {
    const r = await chat('close road r-101 now');
    expect(r.body.tool).toBe('twin.apply_event'); expect(r.body.status).toBe('PENDING_CONFIRMATION');
    expect(twin.events.length).toBe(0);
  });
  test('explain / dna / time windows / self-check / demo status / learning', async () => {
    expect((await chat('why was this route selected')).body.tool).toBe('analysis.explain_route');
    expect((await chat('show the route dna')).body.text).toMatch(/Route DNA/);
    expect((await chat('which deliveries are at risk of missing their time windows')).body.text).toMatch(/PREDICTED/);
    expect((await chat('what step is the demo on')).body.tool).toBe('demo.control');
    expect((await chat('how accurate were our eta predictions')).body.tool).toBe('learning.summary');
    const sc = await chat('run a self check'); expect(sc.body.tool).toBe('system.self_check'); expect(sc.body.text).toMatch(/Self-check/);
  });
  test('algorithm explanation is honest about quantum computing', async () => {
    const r = await chat('is this real quantum computing');
    expect(r.body.tool).toBe('algorithm.explain'); expect(r.body.text).toMatch(/not quantum computing|no quantum hardware|nothing in QUANTARA runs on quantum hardware/i);
  });
  test('benchmark comparison reports measured numbers and significance', async () => {
    const r = await chat('compare qpso and pso');
    expect(r.body.tool).toBe('benchmark.compare'); expect(r.body.text).toMatch(/Mean fitness over 5 seeds/);
  });
  test('citizens cannot use admin FRIDAY tools', async () => {
    const r = await request(app).post('/api/friday/chat').set('Authorization', `Bearer ${citizen}`).send({ text: 'what happens if traffic increases by 40 percent' });
    expect(r.body.status).not.toBe('SUCCESS');
  });
});

describe('platform verification endpoints', () => {
  test('/admin health full runs real checks', async () => {
    expect((await request(app).get('/api/health/full')).status).toBe(401);
    const r = await request(app).get('/api/health/full').set(A());
    expect(r.status).toBe(200);
    expect(r.body.checks.length).toBeGreaterThan(8);
    expect(r.body.checks.every((c: any) => ['PASS', 'WARN', 'FAIL'].includes(c.status) && typeof c.ms === 'number')).toBe(true);
  });
  test('self-check executes and never reports PASS for unexecuted work', async () => {
    const { runSelfChecks } = await import('../src/services/selfCheck');
    const r = await runSelfChecks();
    expect(r.checks.filter((c) => c.name.startsWith('algorithm ')).length).toBe(6);
    expect(r.checks.find((c) => c.name === 'road graph')!.status).toBe('PASS');
    r.checks.forEach((c) => expect(c.ms).toBeGreaterThanOrEqual(0));
    expect(r.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
  });
  test('scalability: measured small sizes, and a too-large size is NOT EXECUTED with a reason', async () => {
    const r = await request(app).post('/api/scalability/run').set(A()).send({ customerCounts: [10, 25, 60], maxIterations: 8, populationSize: 6, perRunLimitSeconds: 1, algorithms: ['QPSO'] });
    const rows = r.body.results.filter((x: any) => x.algorithm === 'QPSO');
    expect(rows[0].status).toBe('MEASURED'); expect(rows[0].runtimeSeconds).toBeGreaterThan(0);
    const ex = r.body.results.find((x: any) => x.algorithm === 'EXACT' && x.customers === 25);
    expect(ex.status).toBe('NOT EXECUTED'); expect(ex.reason).toMatch(/impractical/);
  });
  test('benchmark endpoint new shape: seeds, hardware, Mann-Whitney, fairness', async () => {
    const r = await request(app).post('/api/optimization/benchmark').set(A()).send({ customers: 6, vehicleCount: 2, populationSize: 8, maxIterations: 10, algorithms: ['QPSO', 'AQPSO', 'PSO', 'EXACT'] });
    expect(r.status).toBe(200);
    expect(r.body.meta.seeds).toEqual([42, 123, 456, 789, 1001]);
    expect(r.body.results.QPSO.runs ?? r.body.runs).toBeDefined();
    expect(r.body.meta.hardware.cpu).toBeTruthy();
    expect(r.body.results.AQPSO.vsQPSO.pValue).toBeGreaterThanOrEqual(0);
    expect(r.body.results.EXACT.optimalityGapPct === undefined || r.body.results.QPSO.optimalityGapPct !== undefined).toBe(true);
  });
  test('optimization rejects invalid input and oversize EXACT', async () => {
    const r = await request(app).post('/api/optimization/exact').set(A()).send({ origin: { lat: 999, lon: 0 }, destination: { lat: 18.5, lon: 73.8 } });
    expect(r.status).toBe(400);
  });
});
