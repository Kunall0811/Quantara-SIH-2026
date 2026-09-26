import { Customer, VehicleProfileLite } from './fitness';
import { RoadGraph } from './graph';
import { mulberry32 } from './rng';

export interface GenerateOptions {
  /** capacity headroom over (total demand / fleet size); ensures the instance is capacity-feasible */
  capacityHeadroom?: number;
  /** minute-of-day at which routes start; windows are generated relative to it */
  startTimeMin?: number;
}

/** Seeded, reproducible problem generator (same seed ⇒ identical instance). */
export function generateDataset(
  seed: number, customerCount: number, vehicleCount: number, graph: RoadGraph, depotId: string, opts: GenerateOptions = {},
) {
  const rand = mulberry32(seed);
  const start = opts.startTimeMin ?? 0;
  const customers: Customer[] = [];
  // Delivery instances are city-scale: customers are drawn from the depot's own city sub-network
  // (a Pune depot never gets a Delhi customer), falling back to the whole graph only if that is tiny.
  const cityPrefix = depotId.split('-')[0] + '-';
  let nodes = Array.from(graph.nodes.keys()).filter((id) => id !== depotId && id.startsWith(cityPrefix)).sort();
  if (nodes.length < 3) nodes = Array.from(graph.nodes.keys()).filter((id) => id !== depotId).sort();
  if (!nodes.length) throw new Error('Graph has no candidate customer nodes.');

  for (let i = 0; i < customerCount; i++) {
    const nodeId = nodes[Math.floor(rand() * nodes.length)];
    const demand = Math.floor(rand() * 5) + 1;                    // 1..5 units
    const readyTime = start + Math.floor(rand() * 120);           // 0..120 min after start
    const dueTime = readyTime + Math.floor(rand() * 240) + 60;    // 60..300 min window
    customers.push({ id: `C${i + 1}`, nodeId, demand, readyTime, dueTime, serviceTime: 10 + Math.floor(rand() * 20) });
  }
  const totalDemand = customers.reduce((s, c) => s + c.demand, 0);
  const minCap = Math.ceil((totalDemand / Math.max(1, vehicleCount)) * (opts.capacityHeadroom ?? 1.25));

  const fleet: VehicleProfileLite[] = [];
  for (let i = 0; i < vehicleCount; i++) {
    fleet.push({
      id: `Q-${String(i + 1).padStart(2, '0')}`, fuelEfficiencyKmPerL: 15, fuelType: 'electric', priority: 'normal',
      capacity: Math.max(15 + Math.floor(rand() * 10), minCap), available: true,
    });
  }
  return { customers, fleet };
}

/** Stable fingerprint of a problem instance (recorded with every benchmark / DNA). */
export function datasetFingerprint(customers: Customer[], fleet: VehicleProfileLite[], depotId: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  const canon = JSON.stringify({
    depotId,
    c: customers.map((c) => [c.id, c.nodeId, c.demand, c.readyTime, c.dueTime, c.serviceTime, c.priority ?? 'normal']),
    f: fleet.map((v) => [v.id, v.capacity, v.fuelType, v.fuelEfficiencyKmPerL, v.available !== false]),
  });
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 12).toUpperCase();
}
