import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import routeRoutes from './routes/routeRoutes';
import trafficRoutes from './routes/trafficRoutes';
import weatherRoutes from './routes/weatherRoutes';
import mapsRoutes from './routes/mapsRoutes';
import optimizationRoutes from './routes/optimizationRoutes';
import fridayRoutes from './routes/fridayRoutes';
import adminRoutes from './routes/adminRoutes';
import healthRoutes from './routes/healthRoutes';
import notificationRoutes from './routes/notificationRoutes';
import fleetRoutes from './routes/fleetRoutes';
import scalabilityRoutes from './routes/scalabilityRoutes';
import twinRoutes from './routes/twinRoutes';
import demoRoutes from './routes/demoRoutes';
import advancedRoutes from './routes/advancedRoutes';
import intelligenceRoutes from './routes/intelligenceRoutes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  const apiLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
  app.use('/api', apiLimiter);

  const authLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Too many attempts, please try again shortly.', errorCode: 'RATE_LIMITED' } });
  app.use('/api/auth', authLimiter, authRoutes);

  app.use('/api/routes', routeRoutes);
  app.use('/api/traffic', trafficRoutes);
  app.use('/api/weather', weatherRoutes);
  app.use('/api/maps', mapsRoutes);
  app.use('/api/optimization', optimizationRoutes);
  app.use('/api/friday', fridayRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/fleet', fleetRoutes);
  app.use('/api/scalability', scalabilityRoutes);
  app.use('/api/advanced', advancedRoutes);
  app.use('/api/twin', twinRoutes);
  app.use('/api/demo', demoRoutes);
  app.use('/api/intelligence', intelligenceRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
