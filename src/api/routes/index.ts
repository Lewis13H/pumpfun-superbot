// src/api/routes/index.ts
import { Router } from 'express';
import categoryRoutes from './category-routes';
import buySignalRoutes from './buy-signal-routes';
import tokenRoutes from './tokens';
// import { marketRoutes } from './market.routes';
// import { monitorRoutes } from './monitor.routes';
// import { signalRoutes } from './signal.routes';
// import { settingsRoutes } from './settings.routes';
import dbStatsRoutes from './db-stats';

const router = Router();

// Existing routes
router.use('/tokens', tokenRoutes);
// router.use('/market', marketRoutes);
// router.use('/monitor', monitorRoutes);
// router.use('/signals', signalRoutes);
// router.use('/settings', settingsRoutes);
router.use('/stats', dbStatsRoutes);

// New category routes
router.use('/categories', categoryRoutes);
router.use('/', categoryRoutes); // Also mount at root for /tokens/by-category etc

// New buy signal routes
router.use('/', buySignalRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

export default router;
