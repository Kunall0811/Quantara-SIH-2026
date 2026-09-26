import { Router } from 'express';
import * as ctrl from '../controllers/miscControllers';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.get('/', requireAuth, ctrl.listNotifications);
router.patch('/:id/read', requireAuth, ctrl.markNotificationRead);
router.post('/dismiss-all', requireAuth, ctrl.dismissAllNotifications);
export default router;
