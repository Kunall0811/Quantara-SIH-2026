import { Router } from 'express';
import * as ctrl from '../controllers/twinController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.get('/state', ctrl.state);
router.get('/plans/:id', ctrl.getPlan);
router.get('/roads', ctrl.roads);
router.use(requireRole('admin'));
router.post('/load', ctrl.load);
router.post('/optimize', ctrl.optimize);
router.post('/events', ctrl.applyEvent);
router.post('/reoptimize', ctrl.reoptimize);
router.post('/reset-events', ctrl.resetEvents);
router.post('/execute', ctrl.execute);
router.post('/dispatch', ctrl.dispatch);
export default router;
