import { Router } from 'express';
import { getEvents, getRiskScore, simulateEvent } from '../controllers/intelligenceController';

const router = Router();

router.get('/events', getEvents);
router.get('/risk', getRiskScore);
router.post('/simulate', simulateEvent);

export default router;
