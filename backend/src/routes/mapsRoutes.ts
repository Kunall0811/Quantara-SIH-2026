import { Router } from 'express';
import * as ctrl from '../controllers/miscControllers';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.get('/geocode', requireAuth, ctrl.geocode);
router.get('/reverse-geocode', requireAuth, ctrl.reverseGeocode);
router.get('/search', requireAuth, ctrl.search);
router.get('/route', requireAuth, ctrl.mapRoute);
export default router;
