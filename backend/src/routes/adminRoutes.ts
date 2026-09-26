import { Router } from 'express';
import * as ctrl from '../controllers/adminController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/dashboard', ctrl.dashboard);
router.get('/users', ctrl.listUsers);
router.get('/routes', ctrl.adminRoutes);
router.get('/traffic', ctrl.adminTraffic);
router.get('/optimization', ctrl.adminOptimization);
export default router;
