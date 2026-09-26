import { VrpEvaluation, Customer, VehicleProfileLite } from './fitness';
import { RoadGraph } from './graph';

export interface ConstraintViolation { code: string; message: string }
export interface ValidationResult { feasible: boolean; violations: ConstraintViolation[] }

/**
 * Hard-constraint catalogue (see docs/VRP.md):
 *  C1 capacity · C2 time window · C3 unknown vehicle · C4 unassigned customer
 *  C5 depot start · C6 depot return · C7 duplicate visit · C8 missing customer
 *  C9 unreachable / closed segment · C10 max route duration · C11 unavailable vehicle used
 *  C12 vehicle assignment validity · C13 data integrity
 */
export const MAX_ROUTE_MINUTES = 720;

export function validateVrpSolution(
  evalResult: VrpEvaluation,
  customers: Customer[],
  fleet: VehicleProfileLite[],
  depotId: string,
  _graph: RoadGraph,
): ValidationResult {
  const violations: ConstraintViolation[] = [];
  const known = new Map(customers.map((c) => [c.id, c]));
  const visited = new Set<string>();
  if (evalResult.constraintViolations) violations.push(...evalResult.constraintViolations.filter((v) => v.code === 'C4'));

  for (const route of evalResult.routes) {
    const v = fleet.find((f, i) => (f.id || `V-${String(i + 1).padStart(2, '0')}`) === route.vehicleId);
    if (!v) { violations.push({ code: 'C3', message: `Vehicle ${route.vehicleId} not found in fleet.` }); continue; }
    if (v.available === false) violations.push({ code: 'C11', message: `Unavailable vehicle ${route.vehicleId} was assigned customers.` });
    if (route.order.length > 0 && route.order[0] !== depotId) violations.push({ code: 'C5', message: `Route for ${route.vehicleId} does not start at depot.` });
    if (route.order.length > 1 && route.order[route.order.length - 1] !== depotId) violations.push({ code: 'C6', message: `Route for ${route.vehicleId} does not return to depot.` });

    let load = 0;
    route.customerIds.forEach((cid, k) => {
      const c = known.get(cid);
      if (!c) { violations.push({ code: 'C12', message: `Route for ${route.vehicleId} contains unknown customer ${cid}.` }); return; }
      if (visited.has(cid)) violations.push({ code: 'C7', message: `Customer ${cid} visited multiple times.` });
      visited.add(cid);
      load += c.demand;
      const t = route.stopDetails[k];
      const start = t ? t.serviceStart : route.arrivalTimes[k + 1];
      if (start !== undefined && start > c.dueTime + 1e-9) {
        violations.push({ code: 'C2', message: `Customer ${cid} deadline violated by ${route.vehicleId}: service starts ${start.toFixed(1)}, due ${c.dueTime}.` });
      }
    });
    if (v.capacity !== undefined && load > v.capacity) violations.push({ code: 'C1', message: `${route.vehicleId} exceeds capacity by ${load - v.capacity} units.` });
    if (route.totalTimeMin > MAX_ROUTE_MINUTES) violations.push({ code: 'C10', message: `Route for ${route.vehicleId} exceeds ${MAX_ROUTE_MINUTES / 60} hours.` });
  }

  const unassignedSet = new Set(evalResult.unassigned ?? []);
  for (const c of customers) {
    if (!visited.has(c.id) && !unassignedSet.has(c.id)) violations.push({ code: 'C8', message: `Customer ${c.id} was not visited.` });
  }
  if (evalResult.unreachableSegments > 0) violations.push({ code: 'C9', message: `Routes contain ${evalResult.unreachableSegments} closed or unreachable road segment(s).` });
  if (!(evalResult.distanceKm >= 0) || !(evalResult.durationMin >= 0) || !Number.isFinite(evalResult.fitness)) {
    violations.push({ code: 'C13', message: 'Data integrity error: negative or non-finite distance / duration / fitness.' });
  }

  const feasible = violations.length === 0;
  evalResult.feasible = feasible;
  evalResult.constraintViolations = violations;
  return { feasible, violations };
}

/** Pre-flight validation of a problem instance (used by the API → HTTP 400 with all reasons). */
export function validateProblemInstance(
  customers: Customer[], fleet: VehicleProfileLite[], graph: RoadGraph, depotId?: string,
): string[] {
  const errors: string[] = [];
  if (!depotId || !graph.nodes.has(depotId)) errors.push('Depot node does not exist in the road graph.');
  if (!customers.length) errors.push('Dataset is empty: at least one delivery is required.');
  if (!fleet.length) errors.push('Fleet is empty: at least one vehicle is required.');
  const seenC = new Set<string>();
  for (const c of customers) {
    if (seenC.has(c.id)) errors.push(`Duplicate delivery id ${c.id}.`);
    seenC.add(c.id);
    if (!c.nodeId || !graph.nodes.has(c.nodeId)) errors.push(`Delivery ${c.id} has no valid road-network node (missing / invalid coordinates).`);
    if (!(c.demand >= 0) || !Number.isFinite(c.demand)) errors.push(`Delivery ${c.id} has invalid demand ${c.demand}.`);
    if (!Number.isFinite(c.readyTime) || !Number.isFinite(c.dueTime) || c.dueTime <= c.readyTime) errors.push(`Delivery ${c.id} has an invalid time window [${c.readyTime}, ${c.dueTime}].`);
    if (!(c.serviceTime >= 0)) errors.push(`Delivery ${c.id} has invalid service time.`);
  }
  const seenV = new Set<string>();
  fleet.forEach((v, i) => {
    const id = v.id || `V-${i + 1}`;
    if (seenV.has(id)) errors.push(`Duplicate vehicle id ${id}.`);
    seenV.add(id);
    if (v.capacity !== undefined && !(v.capacity > 0)) errors.push(`Vehicle ${id} has invalid capacity ${v.capacity}.`);
    if (!(v.fuelEfficiencyKmPerL > 0)) errors.push(`Vehicle ${id} has invalid fuel efficiency.`);
  });
  const maxCap = Math.max(0, ...fleet.filter((v) => v.available !== false).map((v) => v.capacity ?? Infinity));
  for (const c of customers) if (Number.isFinite(maxCap) && c.demand > maxCap) errors.push(`Delivery ${c.id} demand ${c.demand} exceeds the largest vehicle capacity ${maxCap}.`);
  return errors;
}
