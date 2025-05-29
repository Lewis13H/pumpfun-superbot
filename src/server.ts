// src/server.ts - Updated for Dashboard Integration
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { Router } from 'express';
import { config } from './config';
import { logger, loggerStream } from './utils/logger';
import { healthRouter } from './api/health';
import { discoveryService } from './discovery/discovery-service';
import marketMetricsRouter, { initializeAnalyzers } from './api/market-metrics';
import monitorRouter from './api/monitor';
import signalsRouter from './api/signals';
import settingsRouter from './api/settings';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3001', 'http://localhost:3000'],
  credentials: true
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging with more details for API endpoints
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    contentType: req.get('content-type'),
  });
  
  // Log response time
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Routes
app.use('/health', healthRouter);

// Enhanced Discovery routes
const discoveryRouter = Router();

discoveryRouter.get('/stats', (req, res) => {
  const stats = discoveryService.getStats();
  res.json({
    ...stats,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

discoveryRouter.post('/start', async (req, res) => {
  try {
    await discoveryService.start();
    res.json({ 
      status: 'started',
      message: 'Discovery service with enhanced analysis started',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to start discovery service:', error);
    res.status(500).json({ 
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

discoveryRouter.post('/stop', async (req, res) => {
  try {
    await discoveryService.stop();
    res.json({ 
      status: 'stopped',
      message: 'Discovery service stopped',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to stop discovery service:', error);
    res.status(500).json({ 
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Analyze specific token
discoveryRouter.post('/analyze/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    logger.info(`Manual analysis requested for token: ${address}`);
    
    const analysis = await discoveryService.analyzeSpecificToken(address);
    
    res.json({
      message: 'Token analysis completed',
      token_address: address,
      analysis: {
        investment_tier: analysis.investmentTier,
        composite_score: analysis.compositeScore,
        market_health_score: analysis.marketHealthScore,
        security_score: analysis.securityScore,
        risk_score: analysis.overallRiskScore,
        confidence_score: analysis.confidenceScore,
        alert_flags: analysis.alertFlags,
        reasoning_points: analysis.reasoningPoints,
        strategies: analysis.strategy,
        processing_time_ms: analysis.processingTimeMs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error(`Failed to analyze token ${req.params.address}:`, error);
    res.status(500).json({ 
      error: errorMessage,
      token_address: req.params.address,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get token analysis results
discoveryRouter.get('/analysis/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const analysis = await discoveryService.getTokenAnalysis(address);
    
    if (!analysis) {
      return res.status(404).json({ 
        error: 'Token analysis not found',
        token_address: address,
        timestamp: new Date().toISOString(),
      });
    }
    
    res.json({
      token_address: address,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error(`Failed to get analysis for ${req.params.address}:`, error);
    res.status(500).json({ 
      error: errorMessage,
      token_address: req.params.address,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get recent alerts
discoveryRouter.get('/alerts', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const alerts = await discoveryService.getRecentAlerts(Number(limit));
    
    res.json({
      total: alerts.length,
      limit: Number(limit),
      alerts,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to get recent alerts:', error);
    res.status(500).json({ 
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Add discovery routes to app
app.use('/discovery', discoveryRouter);

// Add market metrics routes
app.use('/api/market', marketMetricsRouter);

// Add enhanced token routes
const tokensRouter = Router();

// Get tokens with enhanced filtering
tokensRouter.get('/', async (req, res) => {
  try {
    const {
      limit = 50,
      offset = 0,
      tier = 'all',
      platform = 'all',
      min_score = 0,
      max_risk = 1,
      sort = 'composite_score',
      order = 'desc',
      timeframe = '24h'
    } = req.query;

    // Build query
    let query = require('./database/postgres').db('tokens')
      .select(
        'address',
        'symbol', 
        'name',
        'platform',
        'composite_score',
        'safety_score',
        'potential_score',
        'investment_classification',
        'market_cap',
        'liquidity',
        'volume_24h',
        'price',
        'discovered_at',
        'updated_at'
      )
      .where('analysis_status', 'COMPLETED')
      .where('composite_score', '>=', Number(min_score))
      .limit(Number(limit))
      .offset(Number(offset));

    // Time filtering
    if (timeframe !== 'all') {
      const intervals: Record<string, string> = {
        '1h': '1 HOUR',
        '6h': '6 HOURS', 
        '24h': '24 HOURS',
        '7d': '7 DAYS',
      };
      const interval = intervals[timeframe as string] || '24 HOURS';
      query = query.where('discovered_at', '>', require('./database/postgres').db.raw(`NOW() - INTERVAL '${interval}'`));
    }

    // Tier filtering
    if (tier !== 'all') {
      const tierMap: Record<string, string> = {
        'gems': 'HIDDEN_GEM',
        'burst': 'NEW_BURST', 
        'standard': 'STANDARD',
        'risk': 'HIGH_RISK',
        'avoid': 'AVOID',
      };
      if (tierMap[tier as string]) {
        query = query.where('investment_classification', tierMap[tier as string]);
      }
    }

    // Platform filtering
    if (platform !== 'all') {
      query = query.where('platform', platform);
    }

    // Risk filtering  
    if (Number(max_risk) < 1) {
      query = query.where('safety_score', '>=', 1 - Number(max_risk));
    }

    // Sorting
    const validSortFields = ['composite_score', 'safety_score', 'potential_score', 'market_cap', 'volume_24h', 'discovered_at'];
    const sortField = validSortFields.includes(sort as string) ? sort as string : 'composite_score';
    const sortOrder = order === 'asc' ? 'asc' : 'desc';
    query = query.orderBy(sortField, sortOrder);

    const tokens = await query;

    // Get total count for pagination
    const totalQuery = require('./database/postgres').db('tokens')
      .count('* as count')
      .where('analysis_status', 'COMPLETED')
      .where('composite_score', '>=', Number(min_score));

    if (timeframe !== 'all') {
      const intervals: Record<string, string> = {
        '1h': '1 HOUR',
        '6h': '6 HOURS',
        '24h': '24 HOURS', 
        '7d': '7 DAYS',
      };
      const interval = intervals[timeframe as string] || '24 HOURS';
      totalQuery.where('discovered_at', '>', require('./database/postgres').db.raw(`NOW() - INTERVAL '${interval}'`));
    }

    if (tier !== 'all') {
      const tierMap: Record<string, string> = {
        'gems': 'HIDDEN_GEM',
        'burst': 'NEW_BURST',
        'standard': 'STANDARD', 
        'risk': 'HIGH_RISK',
        'avoid': 'AVOID',
      };
      if (tierMap[tier as string]) {
        totalQuery.where('investment_classification', tierMap[tier as string]);
      }
    }

    if (platform !== 'all') {
      totalQuery.where('platform', platform);
    }

    if (Number(max_risk) < 1) {
      totalQuery.where('safety_score', '>=', 1 - Number(max_risk));
    }

    const totalResult = await totalQuery.first();
    const total = parseInt(totalResult?.count || '0');

    // Transform tokens for dashboard
    const transformedTokens = tokens.map((token: any) => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: token.platform,
      createdAt: token.created_at,
      discoveredAt: token.discovered_at,
      marketCap: parseFloat(token.market_cap || '0'),
      price: parseFloat(token.price || '0'),
      priceChange24h: parseFloat(token.price_change_24h || '0'),
      volume24h: parseFloat(token.volume_24h || '0'),
      liquidity: parseFloat(token.liquidity || '0'),
      holders: token.holders || 0,
      safetyScore: parseFloat(token.safety_score || '0'),
      potentialScore: parseFloat(token.potential_score || '0'),
      compositeScore: parseFloat(token.composite_score || '0'),
      investmentClassification: token.investment_classification || 'STANDARD',
      analysisStatus: token.analysis_status
    }));

    res.json(transformedTokens);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to get tokens:', error);
    res.status(500).json({ 
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// Get single token details - Enhanced for dashboard
tokensRouter.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const token = await require('./database/postgres').db('tokens')
      .select('*')
      .where('address', address)
      .first();

    if (!token) {
      return res.status(404).json({ 
        error: 'Token not found',
        token_address: address,
        timestamp: new Date().toISOString(),
      });
    }

    // Get security audit data if available
    const securityAudit = await require('./database/postgres').db('token_security_audits')
      .where('token_address', address)
      .first();

    // Get recent signals if any
    const signals = await require('./database/postgres').db('token_signals')
      .where('token_address', address)
      .orderBy('generated_at', 'desc')
      .limit(10);

    // Format response for dashboard
    const response = {
      // Basic token info
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      marketCap: parseFloat(token.market_cap || '0'),
      price: parseFloat(token.price || '0'),
      priceChange24h: parseFloat(token.price_change_24h || '0'),
      volume24h: parseFloat(token.volume_24h || '0'),
      liquidity: parseFloat(token.liquidity || '0'),
      holders: token.holders || 0,
      
      // Security info
      security: securityAudit ? {
        rugPullRisk: parseFloat(securityAudit.rug_pull_risk || '0.5'),
        honeypot: securityAudit.is_honeypot || false,
        liquidityLocked: securityAudit.liquidity_locked || false,
        mintDisabled: securityAudit.mint_authority_revoked || false,
        topHolderPercent: parseFloat(securityAudit.top_holder_percent || '20'),
        contractVerified: securityAudit.contract_verified || false
      } : {
        rugPullRisk: 0.5,
        honeypot: false,
        liquidityLocked: false,
        mintDisabled: false,
        topHolderPercent: 20,
        contractVerified: false
      },
      
      // Signals
      signals: signals.map((signal: any) => ({
        type: signal.signal_type || 'HOLD',
        confidence: parseFloat(signal.confidence || '0'),
        reason: signal.reasons?.[0] || 'Analysis-based signal',
        timestamp: signal.generated_at || new Date().toISOString()
      })),
      
      // Mock data for now - replace with real data when available
      priceHistory: generateMockPriceHistory(24),
      holderDistribution: [
        { range: '0-100', count: 450, percentage: 45 },
        { range: '100-1K', count: 300, percentage: 30 },
        { range: '1K-10K', count: 200, percentage: 20 },
        { range: '10K+', count: 50, percentage: 5 }
      ],
      smartMoneyActivity: generateMockSmartMoneyActivity()
    };
    
    res.json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error(`Failed to get token ${req.params.address}:`, error);
    res.status(500).json({ 
      error: errorMessage,
      token_address: req.params.address,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/api/tokens', tokensRouter);

// Add API monitoring routes
app.use('/api/monitor', monitorRouter);

// Add signal routes
app.use('/api/signals', signalsRouter);

// Add settings routes
app.use('/api/settings', settingsRouter);

// Initialize analyzers with the discovery service
app.use((req, res, next) => {
  // This middleware runs after the service is initialized
  if (discoveryService.getStats().isRunning) {
    initializeAnalyzers(
      discoveryService.getEnhancedAnalyzer(),
      discoveryService.getMarketAnalyzer()
    );
  }
  next();
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Solana Token Discovery & Analysis API',
    version: '2.2.0',
    module: 'Dashboard Integration Complete',
    endpoints: {
      health: {
        'GET /health': 'Basic health check',
        'GET /health/detailed': 'Detailed system health',
      },
      discovery: {
        'GET /discovery/stats': 'Discovery service statistics',
        'POST /discovery/start': 'Start discovery service',
        'POST /discovery/stop': 'Stop discovery service',
        'POST /discovery/analyze/:address': 'Analyze specific token',
        'GET /discovery/analysis/:address': 'Get token analysis',
        'GET /discovery/alerts': 'Get recent alerts',
      },
      tokens: {
        'GET /api/tokens': 'List tokens with filtering',
        'GET /api/tokens/:address': 'Get token details',
      },
      market: {
        'GET /api/market/overview': 'Market overview and stats',
        'GET /api/market/top-tokens': 'Top performing tokens',
        'GET /api/market/token/:address': 'Detailed token analysis',
        'GET /api/market/token/:address/metrics': 'Real-time token metrics',
        'GET /api/market/token/:address/history': 'Historical price data',
        'GET /api/market/alerts': 'Market alerts',
        'GET /api/market/patterns': 'Trading patterns',
        'GET /api/market/stats': 'Market analyzer statistics',
        'POST /api/market/token/:address/analyze': 'Force token analysis',
      },
      monitor: {
        'GET /api/monitor/status': 'API service status',
        'GET /api/monitor/cost-history': 'API cost history',
        'GET /api/monitor/errors': 'Recent error logs',
      },
      signals: {
        'GET /api/signals/history': 'Trading signal history',
        'GET /api/signals/stats': 'Signal performance stats',
        'GET /api/signals/profit-history': 'Profit/loss history',
      },
      settings: {
        'GET /api/settings': 'Get current settings',
        'PUT /api/settings': 'Update settings',
      },
    },
    features: [
      'Real-time token discovery from PumpFun and Raydium',
      'Enhanced market metrics analysis',
      'Multi-tiered investment classification',
      'Risk assessment and manipulation detection',
      'Trading pattern recognition',
      'Price and volume alert system',
      'Historical data tracking',
      'WebSocket support for real-time updates',
      'Dashboard integration',
      'API monitoring and cost tracking',
      'Signal history and performance tracking',
      'Configurable settings management',
    ],
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.env === 'development' ? err.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The requested endpoint ${req.method} ${req.originalUrl} was not found`,
    available_endpoints: '/api',
    timestamp: new Date().toISOString(),
  });
});

// Helper functions
function generateMockPriceHistory(hours: number) {
  const history = [];
  const basePrice = 0.0001;
  
  for (let i = hours - 1; i >= 0; i--) {
    const time = new Date(Date.now() - i * 60 * 60 * 1000);
    const variance = (Math.random() - 0.5) * 0.2;
    history.push({
      time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      price: basePrice * (1 + variance)
    });
  }
  
  return history;
}

function generateMockSmartMoneyActivity() {
  const activities = [];
  const wallets = ['DV2e...MKtq', 'So11...1112', 'EPjF...AUWE', 'Gq3H...DmPK'];
  const actions = ['BUY', 'SELL'];
  
  for (let i = 0; i < 5; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    activities.push({
      wallet: wallets[Math.floor(Math.random() * wallets.length)],
      action: action as 'BUY' | 'SELL',
      amount: Math.floor(1000 + Math.random() * 10000),
      timestamp: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      profit: action === 'SELL' ? (Math.random() * 100 - 20) : undefined
    });
  }
  
  return activities;
}

export { app };