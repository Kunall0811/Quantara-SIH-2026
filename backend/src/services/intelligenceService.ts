import { IntelligenceEventModel } from '../models/schemas';
import { getIo } from '../socket';
import { closeEdge } from './graphService';

export interface IntelligenceEventData {
  category: 'WEATHER' | 'ROAD_CONDITION' | 'CLOSURE' | 'MAINTENANCE' | 'CROWD' | 'OBSTACLE' | 'LANDSLIDE';
  type: string;
  location?: { lat: number; lon: number; label?: string };
  roadSegment?: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'SEVERE';
  status?: 'DETECTED' | 'VERIFYING' | 'CONFIRMED' | 'CLEARING' | 'CLEARED';
  source?: string;
  confidence?: number;
  isSimulated?: boolean;
  expiresAt?: Date;
}

/**
 * Creates or updates an intelligence event and notifies clients.
 */
export async function createIntelligenceEvent(data: IntelligenceEventData) {
  const event = new IntelligenceEventModel(data);
  await event.save();

  // If it's a closure or severe incident, update the graph
  if (data.category === 'CLOSURE' || data.severity === 'CRITICAL') {
    if (data.roadSegment) {
       closeEdge(data.roadSegment);
    }
  }

  // Notify clients
  const io = getIo();
  if (io) {
    io.emit('intelligence_update', { type: 'NEW_EVENT', event });
    // Also push a global re-calculation of the Road Risk Score
    const risk = await calculateRoadRiskScore();
    io.emit('intelligence_risk_update', risk);
  }

  return event;
}

/**
 * Retrieves all active (not expired, not cleared) intelligence events.
 */
export async function getActiveIntelligenceEvents() {
  const now = new Date();
  return await IntelligenceEventModel.find({
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    status: { $ne: 'CLEARED' }
  }).sort({ createdAt: -1 });
}

/**
 * Dynamically calculates a unified Road Risk Score (0-100).
 */
export async function calculateRoadRiskScore() {
  const events = await getActiveIntelligenceEvents();
  
  let totalRisk = 0;
  const factors: { reason: string; impact: number }[] = [];

  events.forEach(e => {
    let impact = 0;
    if (e.severity === 'LOW') impact = 2;
    else if (e.severity === 'MODERATE') impact = 5;
    else if (e.severity === 'HIGH' || e.severity === 'SEVERE') impact = 15;
    else if (e.severity === 'CRITICAL') impact = 25;

    totalRisk += impact;
    factors.push({ reason: `${e.type} (${e.category})`, impact });
  });

  if (factors.length === 0) {
    totalRisk += 10;
    factors.push({ reason: 'Normal operations', impact: 10 });
  }

  const normalizedScore = Math.min(Math.max(Math.round(totalRisk), 0), 100);
  
  let level = 'LOW';
  if (normalizedScore > 30) level = 'MODERATE';
  if (normalizedScore > 60) level = 'HIGH';
  if (normalizedScore > 85) level = 'CRITICAL';

  return {
    score: normalizedScore,
    level,
    factors: factors.sort((a, b) => b.impact - a.impact).slice(0, 5)
  };
}

/**
 * Simulated Cascade logic. Triggers multiple chained events.
 */
export async function simulateCascade(scenario: string, location: { lat: number; lon: number }, roadSegment: string) {
  const io = getIo();
  
  if (scenario === 'HeavyRainCascade') {
    // 1. Heavy Rain
    await createIntelligenceEvent({
      category: 'WEATHER', type: 'Extreme Rain', location, roadSegment,
      severity: 'SEVERE', source: 'Admin Simulation', isSimulated: true, confidence: 100
    });

    // 2. Waterlogging (delay 3s)
    setTimeout(async () => {
      await createIntelligenceEvent({
        category: 'ROAD_CONDITION', type: 'Waterlogging', location, roadSegment,
        severity: 'HIGH', source: 'Cascade Simulation', isSimulated: true, confidence: 85
      });
      io?.emit('cascade_event', { message: `Waterlogging reported at ${roadSegment} due to Extreme Rain.` });
    }, 3000);

    // 3. Traffic / Crowd (delay 6s)
    setTimeout(async () => {
      await createIntelligenceEvent({
        category: 'CROWD', type: 'Traffic Congestion', location, roadSegment,
        severity: 'HIGH', source: 'Cascade Simulation', isSimulated: true, confidence: 92
      });
      io?.emit('cascade_event', { message: `Severe traffic congestion building at ${roadSegment}.` });
    }, 6000);

    // 4. Road Closure (delay 9s)
    setTimeout(async () => {
      await createIntelligenceEvent({
        category: 'CLOSURE', type: 'Flood Closure', location, roadSegment,
        severity: 'CRITICAL', status: 'CONFIRMED', source: 'Cascade Simulation', isSimulated: true, confidence: 100
      });
      io?.emit('cascade_event', { message: `ROAD CLOSED: ${roadSegment} due to flooding.` });
    }, 9000);
  }
}
