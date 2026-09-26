import { demo, STEPS } from '../src/demo/sihDemo';
import { twin } from '../src/twin/engine';
import { getLastBenchmark } from '../src/optimization/benchmarkStore';

jest.setTimeout(120000);

describe('SIH demo mode (21 real steps)', () => {
  test('runs all 21 steps end-to-end against the real twin, with real numbers', async () => {
    expect(STEPS.length).toBe(21);
    const st = await demo.start({ customers: 8, vehicles: 3, seed: 42, delayMs: 0, iterations: 30 });
    if (st.status !== 'COMPLETED') console.log(st.error, st.steps.filter((s) => s.status !== 'DONE'));
    expect(st.status).toBe('COMPLETED');
    expect(st.steps.every((s) => s.status === 'DONE' && s.result && s.result.summary.length > 10)).toBe(true);
    // the twin really changed: accident + breakdown applied, several plans produced
    expect(twin.events.map((e) => e.request.type)).toEqual(['ACCIDENT', 'VEHICLE_BREAKDOWN']);
    expect(twin.plans.length).toBeGreaterThanOrEqual(3);
    // step content is derived from real plans
    const byId = Object.fromEntries(st.steps.map((s) => [s.id, s]));
    expect(byId['run-qpso'].result!.planId).toMatch(/^PLAN-/);
    expect(byId['adaptive-qpso'].result!.data.adaptive.betaHistory.length).toBeGreaterThan(5);
    expect(byId['benchmark'].result!.source).toBe('MEASURED');
    expect(getLastBenchmark()!.meta.seeds).toEqual([42, 123, 456, 789, 1001]);
    expect(byId['actual-vs-predicted'].result!.summary).toMatch(/SIMULATED_EXECUTION/);
  });

  test('pause / resume / reset semantics', async () => {
    demo.reset();
    const a = await demo.next(); expect(a.current).toBe(1); expect(a.status).toBe('PAUSED');
    const b = await demo.next(); expect(b.current).toBe(2);
    const r = demo.reset(); expect(r.status).toBe('IDLE'); expect(r.current).toBe(0); expect(r.steps.every((s) => s.status === 'PENDING')).toBe(true);
    expect(twin.events.length).toBe(0);
  });
});
