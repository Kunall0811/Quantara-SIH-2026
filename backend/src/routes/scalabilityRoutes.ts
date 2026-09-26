import { Router } from 'express';
import * as ctrl from '../controllers/scalabilityController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.post('/run', ctrl.runScalability);

export default router;
