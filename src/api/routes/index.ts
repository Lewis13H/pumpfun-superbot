import { Router } from 'express';
import tokenRoutes from './tokenRoutes';
import settingsRoutes from './settingsRoutes';

const router = Router();

// Mount routes
router.use('/tokens', tokenRoutes);
router.use('/settings', settingsRoutes);

// Add more routes as you create them
// router.use('/monitoring', monitoringRoutes);
// router.use('/signals', signalRoutes);
// router.use('/wallets', walletRoutes);
// router.use('/system', systemRoutes);

export default router;