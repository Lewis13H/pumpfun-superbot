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
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to get API status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get token metadata
integrationsRouter.get('/metadata/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const metadata = await apiManager.getTokenMetadata(address);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Token metadata not found' });
    }
    
    res.json(metadata);
  } catch (error: any) {
    logger.error('Failed to get token metadata:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get market data
integrationsRouter.get('/market/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const marketData = await apiManager.getTokenMarketData(address);
    
    if (!marketData) {
      return res.status(404).json({ error: 'Market data not found' });
    }
    
    res.json(marketData);
  } catch (error: any) {
    logger.error('Failed to get market data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get security analysis
integrationsRouter.get('/security/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const security = await apiManager.getTokenSecurity(address);
    
    if (!security) {
      return res.status(404).json({ error: 'Security data not found' });
    }
    
    res.json(security);
  } catch (error: any) {
    logger.error('Failed to get security data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get holder analysis
integrationsRouter.get('/holders/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const holders = await apiManager.getTokenHolders(address);
    res.json(holders);
  } catch (error: any) {
    logger.error('Failed to get holder data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get comprehensive token data
integrationsRouter.get('/comprehensive/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const data = await apiManager.getComprehensiveTokenData(address);
    
    if (!data) {
      return res.status(404).json({ error: 'Token data not found' });
    }
    
    res.json(data);
  } catch (error: any) {
    logger.error('Failed to get comprehensive data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to verify APIs are working
integrationsRouter.post('/test', async (req, res) => {
  try {
    const testAddress = req.body.address || 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    
    logger.info(`Testing APIs with token: ${testAddress}`);
    
    const results = {
      metadata: null as any,
      market: null as any,
      security: null as any,
      holders: null as any,
      errors: [] as string[],
    };
    
    // Test each API
    try {
      results.metadata = await apiManager.getTokenMetadata(testAddress);
    } catch (error: any) {
      results.errors.push(`Metadata: ${error.message}`);
    }
    
    try {
      results.market = await apiManager.getTokenMarketData(testAddress);
    } catch (error: any) {
      results.errors.push(`Market: ${error.message}`);
    }
    
    try {
      results.security = await apiManager.getTokenSecurity(testAddress);
    } catch (error: any) {
      results.errors.push(`Security: ${error.message}`);
    }
    
    try {
      results.holders = await apiManager.getTokenHolders(testAddress);
    } catch (error: any) {
      results.errors.push(`Holders: ${error.message}`);
    }
    
    res.json({
      testAddress,
      results,
      success: results.errors.length === 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('API test failed:', error);
    res.status(500).json({ error: error.message });
  }
});