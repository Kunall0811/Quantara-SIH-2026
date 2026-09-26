import { Request, Response } from 'express';
import { createIntelligenceEvent, getActiveIntelligenceEvents, calculateRoadRiskScore, simulateCascade } from '../services/intelligenceService';

export async function getEvents(req: Request, res: Response) {
  try {
    const events = await getActiveIntelligenceEvents();
    res.json({ success: true, events });
  } catch (error) {
    console.error('Error fetching intelligence events:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
}

export async function getRiskScore(req: Request, res: Response) {
  try {
    const risk = await calculateRoadRiskScore();
    res.json({ success: true, risk });
  } catch (error) {
    console.error('Error calculating risk score:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate risk' });
  }
}

export async function simulateEvent(req: Request, res: Response) {
  try {
    const { category, type, location, roadSegment, severity, source, isCascade, scenario } = req.body;

    if (isCascade && scenario) {
      // Background async execution
      simulateCascade(scenario, location, roadSegment).catch(console.error);
      return res.json({ success: true, message: `Cascade simulation '${scenario}' started.` });
    }

    const event = await createIntelligenceEvent({
      category, type, location, roadSegment, severity, source, isSimulated: true, status: 'CONFIRMED', confidence: 100
    });

    res.json({ success: true, event });
  } catch (error) {
    console.error('Error simulating event:', error);
    res.status(500).json({ success: false, error: 'Failed to simulate event' });
  }
}
