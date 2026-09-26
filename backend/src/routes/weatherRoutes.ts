import { Router } from 'express';
import * as ctrl from '../controllers/miscControllers';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.get('/', requireAuth, ctrl.weather);
router.post('/simulate', requireAuth, ctrl.simulateWeather);
export default router;
