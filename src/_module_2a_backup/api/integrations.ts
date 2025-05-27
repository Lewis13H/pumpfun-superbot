// src/api/integrations.ts
import { Router } from 'express';
import { apiManager } from '../integrations/api-manager';
import { logger } from '../utils/logger';

export const integrationsRouter = Router();

// Get API status
integrationsRouter.get('/status', (req, res) => {
  try {
    const status = apiManager.getAPIStatus();
    res.json({
      status: 'ok',
      apis: status,
      message: 'DexScreener integration active',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to get API status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to fetch data for a specific token
integrationsRouter.get('/test/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const data = await apiManager.getComprehensiveTokenData(address);
    
    if (!data) {
      return res.status(404).json({ error: 'Token data not found' });
    }
    
    res.json({
      address,
      data,
      source: 'DexScreener',
    });
  } catch (error: any) {
    logger.error('Test endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Placeholder for other routes
integrationsRouter.get('/test', (req, res) => {
  res.json({
    message: 'API integration with DexScreener active',
    testEndpoint: '/api/integrations/test/:tokenAddress',
    exampleToken: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  });
});