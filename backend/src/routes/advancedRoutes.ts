import { Router } from 'express';
import * as ctrl from '../controllers/advancedController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));
router.get('/scenarios', ctrl.scenarioCatalog);
router.post('/scenario', ctrl.scenarioPreview);
router.post('/resilience', ctrl.resilienceAnalysis);
router.post('/regret', ctrl.regretAnalysis);
router.post('/counterfactual', ctrl.counterfactualAnalysis);
router.post('/time-window-risk', ctrl.timeWindow);
router.post('/route-dna', ctrl.dna);
router.post('/explain', ctrl.explanation);
router.post('/actual-vs-predicted', ctrl.actualVsPredicted);
router.get('/learning', ctrl.learningSummary);
export default router;
