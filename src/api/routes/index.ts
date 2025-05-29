// src/api/routes/index.ts - Version with both default and named exports
import { Router } from 'express';
import tokenRoutes from './tokens';
import { marketRoutes } from './market.routes';
import { monitorRoutes } from './monitor.routes';
import { settingsRoutes } from './settings.routes';
import { signalRoutes } from './signal.routes';

const router = Router();

// API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'solana-token-discovery-api'
  });
});

// Mount route modules
router.use('/tokens', tokenRoutes);
router.use('/market', marketRoutes);
router.use('/monitor', monitorRoutes);
router.use('/settings', settingsRoutes);
router.use('/signals', signalRoutes);

// Default export for the combined router
export default router;

// Named exports for individual routes (for backward compatibility)
export {
  tokenRoutes,
  marketRoutes,
  monitorRoutes,
  settingsRoutes,
  signalRoutes
};