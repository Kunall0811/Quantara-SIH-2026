import { Router } from 'express';
import * as ctrl from '../controllers/fridayController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.post('/chat', requireAuth, ctrl.chat);
router.post('/action', requireAuth, requireRole('admin'), ctrl.action);
router.get('/tts', requireAuth, requireRole('admin'), ctrl.ttsHandler);
router.get('/status', requireAuth, ctrl.status);
router.get('/history', requireAuth, ctrl.history);
export default router;
