import { Router } from 'express';
import * as ctrl from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/send-otp', ctrl.sendOtp);
router.post('/verify-otp', ctrl.verifyOtpHandler);
router.post('/forgot-password', ctrl.sendOtp);
router.post('/reset-password', ctrl.resetPassword);
router.get('/me', requireAuth, ctrl.me);
export default router;
