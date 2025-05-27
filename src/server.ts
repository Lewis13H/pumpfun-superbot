// src/server.ts
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { Router } from 'express';
import { config } from './config';
import { logger, loggerStream } from './utils/logger';
import { healthRouter } from './api/health';
import { discoveryService } from './discovery/discovery-service';
import { analysisService } from './analysis/analysis-service';
import { integrationsRouter } from './api/integrations';
import { db } from './database/postgres';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Routes
app.use('/health', healthRouter);
app.use('/api/integrations', integrationsRouter);

// Discovery routes
const discoveryRouter = Router();

discoveryRouter.get('/stats', (req, res) => {
  res.json(discoveryService.getStats());
});

discoveryRouter.post('/start', async (req, res) => {
  try {
    await discoveryService.start();
    res.json({ status: 'started' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to start discovery service:', error);
    res.status(500).json({ error: errorMessage });
  }
});

discoveryRouter.post('/stop', async (req, res) => {
  try {
    await discoveryService.stop();
    res.json({ status: 'stopped' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to stop discovery service:', error);
    res.status(500).json({ error: errorMessage });
  }
});

app.use('/discovery', discoveryRouter);

// Analysis routes
const analysisRouter = Router();

analysisRouter.get('/stats', (req, res) => {
  res.json(analysisService.getStats());
});

analysisRouter.post('/analyze/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Check if token exists
    const token = await db('tokens')
      .where('address', address)
      .first();
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    // Queue for analysis
    await analysisService.analyzeToken(token);
    
    res.json({ 
      status: 'queued',
      token: {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
      }
    });
  } catch (error: any) {
    logger.error('Failed to queue token for analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

analysisRouter.get('/history/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const history = await db('token_analysis_history')
      .where('token_address', address)
      .orderBy('analyzed_at', 'desc')
      .limit(10);
    
    res.json(history);
  } catch (error: any) {
    logger.error('Failed to get analysis history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/analysis', analysisRouter);

// Token routes
const tokenRouter = Router();

tokenRouter.get('/list', async (req, res) => {
  try {
    const { 
      limit = 50, 
      offset = 0, 
      classification,
      platform,
      sortBy = 'discovered_at',
      order = 'desc'
    } = req.query;
    
    let query = db('tokens');
    
    if (classification) {
      query = query.where('investment_classification', classification);
    }
    
    if (platform) {
      query = query.where('platform', platform);
    }
    
    const tokens = await query
      .orderBy(sortBy as string, order as string)
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));
    
    const total = await db('tokens')
      .count('* as count')
      .first();
    
    res.json({
      tokens,
      total: total?.count || 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logger.error('Failed to list tokens:', error);
    res.status(500).json({ error: error.message });
  }
});

tokenRouter.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const token = await db('tokens')
      .where('address', address)
      .first();
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    // Get latest analysis
    const latestAnalysis = await db('token_analysis_history')
      .where('token_address', address)
      .orderBy('analyzed_at', 'desc')
      .first();
    
    res.json({
      ...token,
      latestAnalysis,
    });
  } catch (error: any) {
    logger.error('Failed to get token:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/tokens', tokenRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.env === 'development' ? err.message : undefined,
  });
});

export { app };