import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import * as ctrl from '../controllers/adminController';

const router = Router();
router.get('/', ctrl.health);
router.get('/database', ctrl.healthDatabase);
router.get('/services', ctrl.healthServices);
// executes every subsystem — admin only (it is CPU-heavy, so it must not be a public endpoint)
router.get('/full', requireAuth, requireRole('admin'), ctrl.healthFull);
export default router;
