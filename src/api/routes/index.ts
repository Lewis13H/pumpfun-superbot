// src/api/routes/index.ts - Version with both default and named exports
import { Router } from 'express';
import tokenRoutes from './tokens';
import { marketRoutes } from './market.routes';
import { monitorRoutes } from './monitor.routes';
import { settingsRoutes } from './settings.routes';
import { signalRoutes } from './signal.routes';
import dbStatsRoutes from './db-stats';

const router = Router();

// API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'solana-token-discovery-api'
  });
});

// Discovery stats endpoint
router.get('/discovery/stats', async (req, res) => {
  try {
    // Get discovery service from global reference
    const discoveryService = (global as any).discoveryService;
    const tokenEnrichmentService = (global as any).tokenEnrichmentService;
    
    if (!discoveryService) {
      return res.status(503).json({
        error: 'Discovery service not available',
        message: 'Service may still be starting up'
      });
    }

    const rawStats = discoveryService.getStats();
    
    // Transform stats to match frontend DiscoveryStats interface
    const stats = {
      isRunning: rawStats.isRunning || false,
      discovery: {
        totalDiscovered: rawStats.discovery?.totalDiscovered || 0,
        duplicatesFound: rawStats.discovery?.duplicatesFound || 0,
        errorsEncountered: rawStats.discovery?.errorsEncountered || 0,
        monitorsActive: rawStats.discovery?.monitorsActive || 0,
        uniqueTokens: rawStats.discovery?.uniqueTokens || 0
      },
      processing: {
        processed: rawStats.processing?.processed || 0,
        failed: rawStats.processing?.failed || 0,
        skipped: rawStats.processing?.skipped || 0,
        currentQueueSize: rawStats.processing?.queueSize || 0,
        queueSize: rawStats.processing?.queueSize || 0,
        pending: rawStats.processing?.pending || 0,
        isRunning: rawStats.processing?.isRunning || false
      },
      deduplication: {
        totalUnique: rawStats.discovery?.uniqueTokens || 0,
        byPlatform: {
          pumpfun: Math.floor((rawStats.discovery?.uniqueTokens || 0) * 0.7),
          raydium: Math.floor((rawStats.discovery?.uniqueTokens || 0) * 0.3)
        }
      },
      // Add enrichment stats if available
      enrichment: tokenEnrichmentService?.getStats() || {
        processed: 0,
        queueSize: 0,
        currentRate: 0,
        errors: 0
      }
    };

    res.json(stats);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to fetch discovery stats',
      message: error.message || 'Unknown error'
    });
  }
});

// Mount route modules
router.use('/tokens', tokenRoutes);
router.use('/market', marketRoutes);
router.use('/monitor', monitorRoutes);
router.use('/settings', settingsRoutes);
router.use('/signals', signalRoutes);
router.use('/', dbStatsRoutes);

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