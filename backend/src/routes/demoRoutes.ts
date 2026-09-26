import { Router } from 'express';
import * as ctrl from '../controllers/demoController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/state', ctrl.state);
router.get('/steps', ctrl.catalog);
router.post('/start', ctrl.start);
router.post('/pause', ctrl.pause);
router.post('/resume', ctrl.resume);
router.post('/reset', ctrl.reset);
router.post('/next', ctrl.next);
export default router;
