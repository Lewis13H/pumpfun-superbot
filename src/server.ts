import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { Router } from 'express';
import { config } from './config';
import { logger, loggerStream } from './utils/logger';
import { healthRouter } from './api/health';
import { discoveryService } from './discovery/discovery-service';
import { db } from './database/postgres';
import { AddressValidator } from './utils/address-validator';

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

// Add discovery routes to app
app.use('/discovery', discoveryRouter);

// Analysis routes
const analysisRouter = Router();

analysisRouter.get('/tokens', async (req, res) => {
  try {
    const { status, limit = 50, classification } = req.query;
    
    let query = db('tokens')
      .select('*')
      .orderBy('composite_score', 'desc')
      .limit(Number(limit));

    if (status) {
      query = query.where('analysis_status', status);
    }

    if (classification) {
      query = query.where('investment_classification', classification);
    }

    const tokens = await query;
    
    res.json({
      count: tokens.length,
      tokens: tokens.map(token => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        scores: {
          safety: token.safety_score,
          potential: token.potential_score,
          composite: token.composite_score,
        },
        classification: token.investment_classification,
        marketCap: token.market_cap,
        liquidity: token.liquidity,
        status: token.analysis_status,
        discoveredAt: token.discovered_at,
        analyzedAt: token.updated_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get tokens:', error);
    res.status(500).json({ error: 'Failed to get tokens' });
  }
});

analysisRouter.get('/tokens/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Validate address
    if (!AddressValidator.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid token address' });
    }

    const token = await db('tokens')
      .where('address', address)
      .first();

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    // Get analysis history
    const history = await db('token_analysis_history')
      .where('token_address', address)
      .orderBy('analyzed_at', 'desc')
      .limit(10);

    res.json({
      token: {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        scores: {
          safety: token.safety_score,
          potential: token.potential_score,
          composite: token.composite_score,
        },
        classification: token.investment_classification,
        marketCap: token.market_cap,
        price: token.price,
        volume24h: token.volume_24h,
        liquidity: token.liquidity,
        status: token.analysis_status,
        metadata: token.raw_data ? JSON.parse(token.raw_data) : {},
        discoveredAt: token.discovered_at,
        analyzedAt: token.updated_at,
      },
      history: history.map(h => ({
        analyzedAt: h.analyzed_at,
        scores: {
          safety: h.safety_score,
          potential: h.potential_score,
          composite: h.composite_score,
        },
      })),
    });
  } catch (error) {
    logger.error('Failed to get token details:', error);
    res.status(500).json({ error: 'Failed to get token details' });
  }
});

analysisRouter.get('/top-opportunities', async (req, res) => {
  try {
    const opportunities = await db('tokens')
      .where('analysis_status', 'COMPLETED')
      .where('composite_score', '>=', 0.65)
      .whereIn('investment_classification', ['STRONG_BUY', 'BUY'])
      .orderBy('composite_score', 'desc')
      .limit(20);

    res.json({
      count: opportunities.length,
      opportunities: opportunities.map(token => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        score: token.composite_score,
        classification: token.investment_classification,
        marketCap: token.market_cap,
        liquidity: token.liquidity,
        discoveredAt: token.discovered_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get opportunities:', error);
    res.status(500).json({ error: 'Failed to get opportunities' });
  }
});

// Add analysis routes to app
app.use('/api/analysis', analysisRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.env === 'development' ? err.message : undefined,
  });
});

export { app };