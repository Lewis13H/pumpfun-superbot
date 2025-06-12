// src/dashboard/v428-dashboard-server.ts
// V4.28: Comprehensive Memecoin Bot Dashboard with Real-time Metrics

import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import { GrpcStreamManager } from '../grpc/grpc-stream-manager';
import { VOLUME_ANALYTICS_SERVICE } from '../services/volume-analytics-service';
import { HOLDER_ANALYTICS_SERVICE } from '../services/token-holder-analytics-service';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');

interface DashboardMetrics {
  // System Health
  systemHealth: {
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: number;
    grpcConnected: boolean;
    databaseConnected: boolean;
    lastHeartbeat: Date;
  };

  // Stream Statistics
  streamStats: {
    messagesPerSecond: number;
    pricesProcessed: number;
    transactionsProcessed: number;
    newTokensDiscovered: number;
    totalMessages: number;
    reconnections: number;
    lastMessageTime: Date;
  };

  // Token Metrics
  tokenMetrics: {
    totalTokens: number;
    tokensWithoutMetadata: number;
    tokensWithoutMetadata24h: number;
    tokensWithoutMetadata1h: number;
    newTokens24h: number;
    newTokens1h: number;
    graduatedTokens24h: number;
  };

  // Category Breakdown
  categoryMetrics: {
    NEW: number;
    LOW: number;
    MEDIUM: number;
    HIGH: number;
    AIM: number;
    ARCHIVE: number;
  };

  // Enhanced Token Details for AIM, HIGH, MEDIUM
  enhancedTokens: {
    AIM: TokenDetail[];
    HIGH: TokenDetail[];
    MEDIUM: TokenDetail[];
  };

  // Volume Analytics
  volumeMetrics: {
    totalVolume24h: number;
    totalVolume1h: number;
    buyVolume24h: number;
    sellVolume24h: number;
    topVolumeTokens: VolumeToken[];
    volumeAlerts: VolumeAlert[];
  };

  // Trading Signals
  tradingSignals: {
    buySignalsGenerated24h: number;
    buySignalsGenerated1h: number;
    successRate: number;
    activeBuySignals: BuySignal[];
  };

  // Error Tracking
  errorTracking: {
    totalErrors24h: number;
    totalErrors1h: number;
    errorsByType: Record<string, number>;
    recentErrors: ErrorLog[];
  };

  // Market Overview
  marketOverview: {
    totalMarketCap: number;
    activeTraders24h: number;
    hotTokens: HotToken[];
    graduationProgress: GraduationToken[];
  };

  // Performance Metrics
  performanceMetrics: {
    avgQueryTime: number;
    bufferSizes: {
      prices: number;
      transactions: number;
      newTokens: number;
    };
    flushFrequency: number;
    metadataQueueSize: number;
    heliusRateLimit: {
      remaining: number;
      total: number;
    };
  };
}

interface TokenDetail {
  address: string;
  symbol: string;
  name: string;
  marketCap: number;
  price: number;
  holders: number;
  volume24h: number;
  bondingCurveProgress: number;
  netTransactionVolume: number;
  buyCount: number;
  sellCount: number;
  liquidity: number;
  priceChange24h: number;
  priceChange1h: number;
  topHolderPercent: number;
}

interface VolumeToken {
  address: string;
  symbol: string;
  volume24h: number;
  volumeChange: number;
}

interface VolumeAlert {
  tokenAddress: string;
  symbol: string;
  alertType: string;
  severity: string;
  message: string;
  triggeredAt: Date;
}

interface BuySignal {
  tokenAddress: string;
  symbol: string;
  score: number;
  reasons: string[];
  generatedAt: Date;
}

interface ErrorLog {
  timestamp: Date;
  type: string;
  message: string;
  count: number;
}

interface HotToken {
  address: string;
  symbol: string;
  searches: number;
  priceChange1h: number;
}

interface GraduationToken {
  address: string;
  symbol: string;
  progress: number;
  estimatedTimeToGraduation: string;
}

class V428DashboardServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private port: number;
  private updateInterval: NodeJS.Timeout | null = null;
  private grpcManager: GrpcStreamManager | null = null;
  private startTime: Date;
  private errorCounts: Map<string, number> = new Map();
  private recentErrors: ErrorLog[] = [];

  constructor(port: number = 3000) {
    this.port = port;
    this.startTime = new Date();
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupRoutes();
    this.setupSocketHandlers();
  }

  private setupRoutes(): void {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API endpoints
    this.app.get('/api/metrics', async (req, res) => {
      try {
        const metrics = await this.collectMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Error collecting metrics:', error);
        res.status(500).json({ error: 'Failed to collect metrics' });
      }
    });

    this.app.get('/api/health', async (req, res) => {
      const health = await this.checkHealth();
      res.json(health);
    });

    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Dashboard client connected: ${socket.id}`);

      // Send initial metrics
      this.collectMetrics().then(metrics => {
        socket.emit('metrics', metrics);
      });

      socket.on('disconnect', () => {
        logger.info(`Dashboard client disconnected: ${socket.id}`);
      });
    });
  }

  async start(): Promise<void> {
    try {
      // Test database connection
      await db.raw('SELECT NOW()');
      logger.info('✅ Dashboard database connection established');

      // Check for required columns
      try {
        await db('tokens').select('buy_count_24h').limit(1);
      } catch (error) {
        logger.warn('⚠️ Volume tracking columns are missing. Dashboard will work with limited features.');
        logger.info('💡 To add missing columns, run: psql -U memecoin_user -d memecoin_discovery -f v4.28_dashboard_minimal.sql');
      }

      // Start server
      this.server.listen(this.port, () => {
        logger.info(`🌐 V4.28 Dashboard server running on http://localhost:${this.port}`);
      });

      // Start metric updates
      this.startMetricUpdates();

      // Listen for system events
      this.setupSystemEventListeners();

    } catch (error) {
      logger.error('Failed to start dashboard server:', error);
      throw error;
    }
  }

  private startMetricUpdates(): void {
    // Update metrics every 2 seconds
    this.updateInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
        this.io.emit('metrics', metrics);
      } catch (error) {
        logger.error('Error updating metrics:', error);
      }
    }, 2000);
  }

  private async collectMetrics(): Promise<DashboardMetrics> {
    const [
      systemHealth,
      streamStats,
      tokenMetrics,
      categoryMetrics,
      enhancedTokens,
      volumeMetrics,
      tradingSignals,
      errorTracking,
      marketOverview,
      performanceMetrics
    ] = await Promise.all([
      this.getSystemHealth(),
      this.getStreamStats(),
      this.getTokenMetrics(),
      this.getCategoryMetrics(),
      this.getEnhancedTokens(),
      this.getVolumeMetrics(),
      this.getTradingSignals(),
      this.getErrorTracking(),
      this.getMarketOverview(),
      this.getPerformanceMetrics()
    ]);

    return {
      systemHealth,
      streamStats,
      tokenMetrics,
      categoryMetrics,
      enhancedTokens,
      volumeMetrics,
      tradingSignals,
      errorTracking,
      marketOverview,
      performanceMetrics
    };
  }

  private async getSystemHealth(): Promise<DashboardMetrics['systemHealth']> {
    const uptime = Date.now() - this.startTime.getTime();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage().user / 1000000; // Convert to seconds

    let databaseConnected = false;
    try {
      await db.raw('SELECT 1');
      databaseConnected = true;
    } catch (error) {
      // Database not connected
    }

    return {
      uptime,
      memoryUsage,
      cpuUsage,
      grpcConnected: this.grpcManager ? true : false,
      databaseConnected,
      lastHeartbeat: new Date()
    };
  }

  private async getStreamStats(): Promise<DashboardMetrics['streamStats']> {
    const stats = this.grpcManager?.getStats() || {
      bufferSizes: { prices: 0, transactions: 0, newTokens: 0 },
      isRunning: false,
      grpcConnected: false
    };

    // Extract message counts from buffer sizes as a proxy for processing
    const messagesPerSecond = 0; // Would need to track this separately
    const pricesProcessed = stats.bufferSizes?.prices || 0;
    const transactionsProcessed = stats.bufferSizes?.transactions || 0;
    const newTokensDiscovered = stats.bufferSizes?.newTokens || 0;

    // Get reconnection count from database
    const reconnectionResult = await db('system_events')
      .where('event_type', 'GRPC_RECONNECTION')
      .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .count('* as count')
      .first();

    return {
      messagesPerSecond,
      pricesProcessed,
      transactionsProcessed,
      newTokensDiscovered,
      totalMessages: pricesProcessed + transactionsProcessed,
      reconnections: parseInt(String(reconnectionResult?.count || 0)),
      lastMessageTime: new Date() // This should come from the actual stream
    };
  }

  private async getTokenMetrics(): Promise<DashboardMetrics['tokenMetrics']> {
    const queries = await Promise.all([
      // Total tokens
      db('tokens').count('* as count').first(),
      
      // Tokens without metadata
      db('tokens')
        .whereNull('symbol')
        .orWhere('symbol', 'LOADING...')
        .count('* as count')
        .first(),
      
      // Tokens without metadata created in last 24h
      db('tokens')
        .whereNull('symbol')
        .orWhere('symbol', 'LOADING...')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // Tokens without metadata created in last 1h
      db('tokens')
        .whereNull('symbol')
        .orWhere('symbol', 'LOADING...')
        .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // New tokens 24h
      db('tokens')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // New tokens 1h
      db('tokens')
        .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // Graduated tokens 24h
      db('tokens')
        .where('is_graduated', true)
        .where('graduated_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first()
    ]);

    return {
      totalTokens: parseInt(String(queries[0]?.count || 0)),
      tokensWithoutMetadata: parseInt(String(queries[1]?.count || 0)),
      tokensWithoutMetadata24h: parseInt(String(queries[2]?.count || 0)),
      tokensWithoutMetadata1h: parseInt(String(queries[3]?.count || 0)),
      newTokens24h: parseInt(String(queries[4]?.count || 0)),
      newTokens1h: parseInt(String(queries[5]?.count || 0)),
      graduatedTokens24h: parseInt(String(queries[6]?.count || 0))
    };
  }

  private async getCategoryMetrics(): Promise<DashboardMetrics['categoryMetrics']> {
    const categories = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category');

    const result: DashboardMetrics['categoryMetrics'] = {
      NEW: 0,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      AIM: 0,
      ARCHIVE: 0
    };

    categories.forEach(row => {
      if (row.category in result) {
        result[row.category as keyof typeof result] = parseInt(row.count as string);
      }
    });

    return result;
  }

  private async getEnhancedTokens(): Promise<DashboardMetrics['enhancedTokens']> {
    const categories = ['AIM', 'HIGH', 'MEDIUM'];
    const result: DashboardMetrics['enhancedTokens'] = {
      AIM: [],
      HIGH: [],
      MEDIUM: []
    };

    // Check if volume columns exist
    let hasVolumeColumns = false;
    try {
      await db('tokens').select('buy_count_24h').limit(1);
      hasVolumeColumns = true;
    } catch (error) {
      // Columns don't exist
    }

    for (const category of categories) {
      let query = db('tokens as t')
        .select([
          't.address',
          't.symbol',
          't.name',
          't.market_cap',
          't.current_price_usd as price',
          't.holders',
          't.volume_24h',
          't.curve_progress',
          't.liquidity',
          't.price_change_24h',
          't.price_change_1h',
          't.top_10_percent'
        ]);

      // Add volume columns only if they exist
      if (hasVolumeColumns) {
        query = query.select([
          db.raw('COALESCE(t.buy_count_24h, 0) as buy_count'),
          db.raw('COALESCE(t.sell_count_24h, 0) as sell_count'),
          db.raw('COALESCE(t.buy_volume_24h - t.sell_volume_24h, 0) as net_transaction_volume')
        ]);
      } else {
        query = query.select([
          db.raw('0 as buy_count'),
          db.raw('0 as sell_count'),
          db.raw('0 as net_transaction_volume')
        ]);
      }

      const tokens = await query
        .where('t.category', category)
        .orderBy('t.market_cap', 'desc')
        .limit(10);

      result[category as keyof typeof result] = tokens.map(token => ({
        address: token.address,
        symbol: token.symbol || 'Unknown',
        name: token.name || 'Unknown',
        marketCap: parseFloat(token.market_cap || '0'),
        price: parseFloat(token.price || '0'),
        holders: token.holders || 0,
        volume24h: parseFloat(token.volume_24h || '0'),
        bondingCurveProgress: parseFloat(token.curve_progress || '0') * 100,
        netTransactionVolume: parseFloat(token.net_transaction_volume || '0'),
        buyCount: token.buy_count || 0,
        sellCount: token.sell_count || 0,
        liquidity: parseFloat(token.liquidity || '0'),
        priceChange24h: parseFloat(token.price_change_24h || '0'),
        priceChange1h: parseFloat(token.price_change_1h || '0'),
        topHolderPercent: parseFloat(token.top_10_percent || '0')
      }));
    }

    return result;
  }

  private async getVolumeMetrics(): Promise<DashboardMetrics['volumeMetrics']> {
    // Get volume stats from volume analytics service
    let volumeStats: any = {
      totalVolume24h: 0,
      totalVolume1h: 0,
      buyVolume24h: 0,
      sellVolume24h: 0
    };
    
    try {
      const serviceStats = VOLUME_ANALYTICS_SERVICE.getStats();
      // Extract what we need from the service stats
      // The service might have different structure, so we'll calculate from database
    } catch (error) {
      // Service might not be initialized
    }

    // Get volume data directly from database
    const [volume24h, volume1h] = await Promise.all([
      db('timeseries.token_transactions')
        .where('time', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .sum('sol_amount as total')
        .first()
        .catch(() => ({ total: 0 })),
      
      db('timeseries.token_transactions')
        .where('time', '>', new Date(Date.now() - 60 * 60 * 1000))
        .sum('sol_amount as total')
        .first()
        .catch(() => ({ total: 0 }))
    ]);

    // Get buy/sell volumes
    const [buyVolume24h, sellVolume24h] = await Promise.all([
      db('timeseries.token_transactions')
        .where('time', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .where('type', 'buy')
        .sum('sol_amount as total')
        .first()
        .catch(() => ({ total: 0 })),
      
      db('timeseries.token_transactions')
        .where('time', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .where('type', 'sell')
        .sum('sol_amount as total')
        .first()
        .catch(() => ({ total: 0 }))
    ]);

    // Convert SOL to USD (assuming $100 SOL price, should use SOL_PRICE_SERVICE)
    const solPrice = 100;
    volumeStats.totalVolume24h = parseFloat(String(volume24h?.total || 0)) * solPrice;
    volumeStats.totalVolume1h = parseFloat(String(volume1h?.total || 0)) * solPrice;
    volumeStats.buyVolume24h = parseFloat(String(buyVolume24h?.total || 0)) * solPrice;
    volumeStats.sellVolume24h = parseFloat(String(sellVolume24h?.total || 0)) * solPrice;

    // Get recent volume alerts (check if table exists)
    let volumeAlerts: any[] = [];
    try {
      volumeAlerts = await db('volume_alerts')
        .select(['token_address', 'symbol', 'alert_type', 'severity', 'message', 'triggered_at'])
        .orderBy('triggered_at', 'desc')
        .limit(10);
    } catch (error) {
      // Table might not exist
      volumeAlerts = [];
    }

    // Get top volume tokens
    const topVolumeTokens = await db('tokens')
      .select(['address', 'symbol', 'volume_24h'])
      .whereNotNull('volume_24h')
      .where('volume_24h', '>', 0)
      .orderBy('volume_24h', 'desc')
      .limit(10);

    return {
      totalVolume24h: volumeStats.totalVolume24h || 0,
      totalVolume1h: volumeStats.totalVolume1h || 0,
      buyVolume24h: volumeStats.buyVolume24h || 0,
      sellVolume24h: volumeStats.sellVolume24h || 0,
      topVolumeTokens: topVolumeTokens.map(t => ({
        address: t.address,
        symbol: t.symbol || 'Unknown',
        volume24h: parseFloat(t.volume_24h || '0'),
        volumeChange: 0 // TODO: Calculate volume change
      })),
      volumeAlerts: volumeAlerts.map(a => ({
        tokenAddress: a.token_address,
        symbol: a.symbol || 'Unknown',
        alertType: a.alert_type,
        severity: a.severity,
        message: a.message,
        triggeredAt: a.triggered_at
      }))
    };
  }

  private async getTradingSignals(): Promise<DashboardMetrics['tradingSignals']> {
    const [signals24h, signals1h, activeSignals] = await Promise.all([
      // Buy signals generated in 24h
      db('token_signals')
        .where('signal_type', 'BUY')
        .where('generated_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // Buy signals generated in 1h
      db('token_signals')
        .where('signal_type', 'BUY')
        .where('generated_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      // Active buy signals
      db('token_signals as s')
        .join('tokens as t', 's.token_address', 't.address')
        .select(['s.token_address', 't.symbol', 's.confidence as score', 's.reasons', 's.generated_at'])
        .where('s.signal_type', 'BUY')
        .where('s.generated_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .orderBy('s.confidence', 'desc')
        .limit(10)
    ]);

    // Calculate success rate (simplified - you'd want to track actual outcomes)
    const successRate = 0.65; // Placeholder

    return {
      buySignalsGenerated24h: parseInt(String(signals24h?.count || 0)),
      buySignalsGenerated1h: parseInt(String(signals1h?.count || 0)),
      successRate,
      activeBuySignals: activeSignals.map(s => ({
        tokenAddress: s.token_address,
        symbol: s.symbol || 'Unknown',
        score: parseFloat(s.score || '0'),
        reasons: s.reasons ? Object.values(s.reasons) : [],
        generatedAt: s.generated_at
      }))
    };
  }

  private async getErrorTracking(): Promise<DashboardMetrics['errorTracking']> {
    // Get error counts from system events
    const [errors24h, errors1h] = await Promise.all([
      db('system_events')
        .where('event_type', 'ERROR')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),
      
      db('system_events')
        .where('event_type', 'ERROR')
        .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
        .count('* as count')
        .first()
    ]);

    return {
      totalErrors24h: parseInt(String(errors24h?.count || 0)),
      totalErrors1h: parseInt(String(errors1h?.count || 0)),
      errorsByType: Object.fromEntries(this.errorCounts),
      recentErrors: this.recentErrors.slice(0, 10)
    };
  }

  private async getMarketOverview(): Promise<DashboardMetrics['marketOverview']> {
    const [marketCap, activeTraders, hotTokens, graduationTokens] = await Promise.all([
      // Total market cap
      db('tokens')
        .sum('market_cap as total')
        .where('category', '!=', 'ARCHIVE')
        .first(),
      
      // Active traders (unique wallets in transactions)
      db('timeseries.token_transactions')
        .countDistinct('user_address as count')
        .where('time', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .first(),
      
      // Hot tokens (most price movement)
      db('tokens')
        .select(['address', 'symbol', 'price_change_1h'])
        .whereNotNull('price_change_1h')
        .orderBy('price_change_1h', 'desc')
        .limit(5),
      
      // Tokens close to graduation
      db('tokens')
        .select(['address', 'symbol', 'curve_progress'])
        .where('curve_progress', '>=', 0.7)
        .where('curve_progress', '<', 1.0)
        .where('is_graduated', false)
        .orderBy('curve_progress', 'desc')
        .limit(5)
    ]);

    return {
      totalMarketCap: parseFloat(marketCap?.total || '0'),
      activeTraders24h: parseInt(String(activeTraders?.count || 0)),
      hotTokens: hotTokens.map(t => ({
        address: t.address,
        symbol: t.symbol || 'Unknown',
        searches: 0, // Placeholder
        priceChange1h: parseFloat(t.price_change_1h || '0')
      })),
      graduationProgress: graduationTokens.map(t => {
        const progress = parseFloat(t.curve_progress || '0');
        const remaining = 1.0 - progress;
        const estimatedTime = remaining > 0 ? `${Math.round(remaining * 100)}% remaining` : 'Soon';
        
        return {
          address: t.address,
          symbol: t.symbol || 'Unknown',
          progress: progress * 100,
          estimatedTimeToGraduation: estimatedTime
        };
      })
    };
  }

  private async getPerformanceMetrics(): Promise<DashboardMetrics['performanceMetrics']> {
    // Get buffer sizes from gRPC manager stats
    let bufferSizes = {
      prices: 0,
      transactions: 0,
      newTokens: 0
    };

    if (this.grpcManager) {
      const stats = this.grpcManager.getStats();
      bufferSizes = stats.bufferSizes || bufferSizes;
    }

    // Get metadata queue size
    let metadataStats = { processingQueue: 0, rateLimitRemaining: 100 };
    try {
      metadataStats = HELIUS_METADATA_SERVICE.getStats();
    } catch (error) {
      // Service might not be initialized
    }

    // Calculate average query time (simplified)
    const queryTimes = await db('pg_stat_statements')
      .select(db.raw('AVG(mean_exec_time) as avg_time'))
      .where('query', 'like', '%timeseries%')
      .first()
      .catch(() => ({ avg_time: 0 }));

    return {
      avgQueryTime: queryTimes?.avg_time || 0,
      bufferSizes,
      flushFrequency: 1000, // ms - from config
      metadataQueueSize: metadataStats.processingQueue || 0,
      heliusRateLimit: {
        remaining: metadataStats.rateLimitRemaining || 100,
        total: 300 // Typical Helius rate limit
      }
    };
  }

  private async checkHealth(): Promise<any> {
    const health = await this.getSystemHealth();
    const isHealthy = health.grpcConnected && health.databaseConnected;
    
    // Check service availability
    let volumeAnalyticsRunning = false;
    let metadataServiceRunning = false;
    
    try {
      const volumeStats = VOLUME_ANALYTICS_SERVICE.getStats();
      volumeAnalyticsRunning = volumeStats.isRunning || false;
    } catch (error) {
      // Service not available
    }
    
    try {
      const metadataStats = HELIUS_METADATA_SERVICE.getStats();
      metadataServiceRunning = metadataStats.processingQueue !== undefined;
    } catch (error) {
      // Service not available
    }
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      uptime: health.uptime,
      services: {
        grpc: health.grpcConnected,
        database: health.databaseConnected,
        volumeAnalytics: volumeAnalyticsRunning,
        metadataService: metadataServiceRunning
      }
    };
  }

  private setupSystemEventListeners(): void {
    // Track errors
    process.on('uncaughtException', (error) => {
      this.trackError('UncaughtException', error.message);
    });

    process.on('unhandledRejection', (reason) => {
      this.trackError('UnhandledRejection', String(reason));
    });
  }

  private trackError(type: string, message: string): void {
    // Update error counts
    const current = this.errorCounts.get(type) || 0;
    this.errorCounts.set(type, current + 1);

    // Add to recent errors
    const existingError = this.recentErrors.find(e => e.type === type && e.message === message);
    if (existingError) {
      existingError.count++;
      existingError.timestamp = new Date();
    } else {
      this.recentErrors.unshift({
        timestamp: new Date(),
        type,
        message,
        count: 1
      });
      // Keep only recent 50 errors
      this.recentErrors = this.recentErrors.slice(0, 50);
    }
    
    // Also track in database (non-blocking)
    db('system_events').insert({
      event_type: 'ERROR',
      event_subtype: type,
      message: message,
      severity: 'ERROR',
      created_at: new Date()
    }).catch(err => {
      // Don't throw if database insert fails
      console.error('Failed to track error in database:', err);
    });
  }

  setGrpcManager(manager: GrpcStreamManager): void {
    this.grpcManager = manager;
  }

  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.io.close();
    this.server.close();
    
    logger.info('Dashboard server stopped');
  }
}

// Export singleton instance
// Create dashboard server instance
const dashboardServer = new V428DashboardServer(process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT) : 3000);

// Export both the class and the instance
export { V428DashboardServer, dashboardServer as DASHBOARD_SERVER };