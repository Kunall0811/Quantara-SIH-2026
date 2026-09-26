/** Real before/after comparison between two plans (or a plan and its stale re-simulation). */
import { Plan, PlanTotals, MISSED_DELIVERY_MINUTES } from './types';

export interface PlanDiff {
  delta: { timeMin: number; distanceKm: number; fuelCostInr: number; co2Kg: number; riskScore: number; latenessMin: number; makespanMin: number; fitness: number };
  reassigned: { deliveryId: string; label: string; from: string | null; to: string | null }[];
  changedRoutes: { vehicleId: string; before: string[]; after: string[]; distanceDeltaKm: number; timeDeltaMin: number }[];
  unchangedRoutes: string[];
  newlyUnassigned: string[]; recovered: string[];
}

export const effectiveDelayMin = (t: Pick<PlanTotals, 'latenessMin'>, unassigned: number) => t.latenessMin + unassigned * MISSED_DELIVERY_MINUTES;

export function diffPlans(before: Plan, after: Plan): PlanDiff {
  const ownerB = new Map<string, string>(); const ownerA = new Map<string, string>();
  const label = new Map<string, string>();
  before.routes.forEach((r) => r.stops.forEach((s) => { ownerB.set(s.deliveryId, r.vehicleId); label.set(s.deliveryId, s.label); }));
  after.routes.forEach((r) => r.stops.forEach((s) => { ownerA.set(s.deliveryId, r.vehicleId); label.set(s.deliveryId, s.label); }));
  const ids = new Set([...ownerB.keys(), ...ownerA.keys(), ...before.unassigned, ...after.unassigned]);
  const reassigned: PlanDiff['reassigned'] = [];
  for (const id of [...ids].sort()) {
    const f = ownerB.get(id) ?? null, t = ownerA.get(id) ?? null;
    if (f !== t) reassigned.push({ deliveryId: id, label: label.get(id) ?? id, from: f, to: t });
  }
  const vids = new Set([...before.routes.map((r) => r.vehicleId), ...after.routes.map((r) => r.vehicleId)]);
  const changedRoutes: PlanDiff['changedRoutes'] = []; const unchangedRoutes: string[] = [];
  for (const v of [...vids].sort()) {
    const b = before.routes.find((r) => r.vehicleId === v), a = after.routes.find((r) => r.vehicleId === v);
    const bs = b?.stops.map((s) => s.deliveryId) ?? [], as = a?.stops.map((s) => s.deliveryId) ?? [];
    const samePath = JSON.stringify(b?.nodePath ?? []) === JSON.stringify(a?.nodePath ?? []);
    if (JSON.stringify(bs) === JSON.stringify(as) && samePath) unchangedRoutes.push(v);
    else changedRoutes.push({ vehicleId: v, before: bs, after: as, distanceDeltaKm: (a?.distanceKm ?? 0) - (b?.distanceKm ?? 0), timeDeltaMin: (a?.totalTimeMin ?? 0) - (b?.totalTimeMin ?? 0) });
  }
  const bt = before.totals, at = after.totals;
  return {
    delta: {
      timeMin: at.totalTimeMin - bt.totalTimeMin, distanceKm: at.distanceKm - bt.distanceKm, fuelCostInr: at.fuelCostInr - bt.fuelCostInr, co2Kg: at.co2Kg - bt.co2Kg,
      riskScore: at.riskScore - bt.riskScore, latenessMin: at.latenessMin - bt.latenessMin, makespanMin: at.makespanMin - bt.makespanMin, fitness: after.fitness - before.fitness,
    },
    reassigned, changedRoutes, unchangedRoutes,
    newlyUnassigned: after.unassigned.filter((x) => !before.unassigned.includes(x)),
    recovered: before.unassigned.filter((x) => !after.unassigned.includes(x)),
  };
}
