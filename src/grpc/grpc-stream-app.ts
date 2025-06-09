// src/grpc/grpc-stream-app.ts - MODIFIED FOR V4.23 WITH HOLDER ANALYTICS
// This shows the exact changes needed to your existing file

import { GrpcStreamManager } from './grpc-stream-manager';
import { db } from '../database/postgres';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
import { logger } from '../utils/logger2';
import { config } from '../config';
import { WebSocketService } from '../websocket/websocket-service';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';
import { HOLDER_ANALYTICS_SERVICE } from '../services/token-holder-analytics-service'; 

// Import Helius metadata service
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');


export class GrpcStreamApplication {
  private streamManager: GrpcStreamManager;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private wsService?: WebSocketService;
  private statsInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private metadataFixInterval?: NodeJS.Timeout;
  private holderAnalyticsInterval?: NodeJS.Timeout; // ADD THIS LINE
  
  constructor() {
    // Initialize without passing db - they'll use their own instances
    this.categoryManager = new CategoryManager();
    this.buySignalEvaluator = new BuySignalEvaluator();
    
    this.streamManager = new GrpcStreamManager(
      {
        grpcEndpoint: config.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
        grpcToken: config.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b',
        batchSize: config.GRPC_BATCH_SIZE || 1000,
        flushInterval: config.GRPC_FLUSH_INTERVAL || 1000,
        priceChangeInterval: config.PRICE_CHANGE_INTERVAL || 5 * 60 * 1000
      },
      db,
      this.categoryManager,
      this.buySignalEvaluator
    );
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Handle new tokens - MODIFIED TO ADD HOLDER ANALYTICS
    this.streamManager.on('newToken', async (token: any) => {
      logger.info(`🎉 New token discovered: ${token.address.substring(0, 8)}... | Metadata & holder analysis queuing...`);
      
      // NEW: Queue for holder analysis  
      HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(token.address, 'HIGH');
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('newToken', token);
      }
    });
    
    // Handle metadata updates from Shyft service
    this.streamManager.on('metadataUpdated', async (data: any) => {
      logger.info(`📝 Metadata updated: ${data.tokenAddress.substring(0, 8)}... → ${data.symbol} (${data.name})`);
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('metadataUpdated', data);
      }
    });

    // NEW: Handle holder analytics updates
    HOLDER_ANALYTICS_SERVICE.on('holdersUpdated', async (holderMetrics: any) => {
      const tokenData = await db('tokens').where('address', holderMetrics.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : holderMetrics.tokenAddress.substring(0, 8) + '...';

      logger.info(`📊 Holders updated: ${displaySymbol} | ${holderMetrics.totalHolders} holders | Top 10%: ${holderMetrics.top10Percent}%`);

      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('holdersUpdated', {
          ...holderMetrics,
          symbol: displaySymbol
        });
      }

      // If this is an AIM token with fresh holder data, re-evaluate for buy signals
      if (tokenData?.category === 'AIM' && holderMetrics.totalHolders >= 30) {
        logger.info(`🎯 Re-evaluating AIM token ${displaySymbol} with fresh holder data`);
        
        setTimeout(async () => {
          try {
            const evaluation = await this.buySignalEvaluator.evaluateToken(holderMetrics.tokenAddress);
            if (evaluation.passed) {
              // Emit buy signal with holder context
              if (this.wsService) {
                this.wsService.broadcast('buySignal', { 
                  token: tokenData, 
                  signal: {
                    ...evaluation,
                    holderData: {
                      total: tokenData?.holders,
                      top10Concentration: tokenData?.top_10_percent,
                      top25Concentration: tokenData?.top_25_percent,
                      lastUpdated: tokenData?.holder_last_updated
                    }
                  }
                });
              }
            }
          } catch (error) {
            logger.error(`Error re-evaluating token after holder update:`, error);
          }
        }, 5000); // Wait 5 seconds for data to propagate
      }
    });
    
    // Handle buy signals - ENHANCED WITH HOLDER DATA CONTEXT
    this.streamManager.on('buySignal', async ({ token, signal }: { token: any; signal: any }) => {
      // Get updated token symbol for display
      const tokenData = await db('tokens').where('address', token.address).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : token.address.substring(0, 8) + '...';
      
      // Enhanced logging with holder data
      logger.info(`💰 Buy signal for ${displaySymbol}: ${signal.reason}`, {
        marketCap: signal.marketCap,
        liquidity: signal.liquidity,
        holders: signal.holders,
        concentration: signal.top10Percent + '%',
        solsniffer: signal.solsnifferScore
      });
      
      // Broadcast to WebSocket clients with holder context
      if (this.wsService) {
        this.wsService.broadcast('buySignal', { 
          token: tokenData || token, 
          signal: {
            ...signal,
            holderData: {
              total: tokenData?.holders,
              top10Concentration: tokenData?.top_10_percent,
              top25Concentration: tokenData?.top_25_percent,
              lastUpdated: tokenData?.holder_last_updated
            }
          }
        });
      }
      
      // Could trigger automated trading here
    });

    // NEW: Handle category changes - queue holder analysis for new AIM tokens
    this.streamManager.on('categoryChanged', async (data: any) => {
      // When a token moves to AIM category, prioritize holder analysis
      if (data.toCategory === 'AIM') {
        logger.info(`🎯 Token moved to AIM: ${data.tokenAddress} - prioritizing holder analysis`);
        HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(data.tokenAddress, 'HIGH');
      }
    });
    
    // Handle price movements - ENHANCED WITH HOLDER REFRESH LOGIC
    this.streamManager.on('pumpDetected', async (data: any) => {
      // Get token symbol for better logging
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🚀 PUMP: ${displaySymbol} +${data.priceChange.toFixed(1)}% | $${data.marketCap.toFixed(0)} MC`);

      // NEW: For significant pumps, refresh holder data (may have new buyers)
      if (data.priceChange > 20 && tokenData?.category === 'AIM') {
        logger.info(`📊 Significant pump detected - refreshing holder data for ${displaySymbol}`);
        HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(data.tokenAddress, 'HIGH');
      }
      
      if (this.wsService) {
        this.wsService.broadcast('pumpDetected', { ...data, symbol: displaySymbol });
      }
    });
    
    this.streamManager.on('dumpDetected', async (data: any) => {
      // Get token symbol for better logging
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.warn(`📉 DUMP: ${displaySymbol} ${data.priceChange.toFixed(1)}% | $${data.marketCap.toFixed(0)} MC`);
      
      if (this.wsService) {
        this.wsService.broadcast('dumpDetected', { ...data, symbol: displaySymbol });
      }
    });
    
    // Handle graduation events
    this.streamManager.on('nearGraduation', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🎓 NEAR GRADUATION: ${displaySymbol} ${data.progress.toFixed(1)}% complete`);
      
      if (this.wsService) {
        this.wsService.broadcast('nearGraduation', { ...data, symbol: displaySymbol });
      }
    });
    
    this.streamManager.on('tokenGraduated', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🎓 GRADUATED: ${displaySymbol} → Raydium`);
      
      if (this.wsService) {
        this.wsService.broadcast('tokenGraduated', { ...data, symbol: displaySymbol });
      }
    });
    
    // Handle errors
    this.streamManager.on('error', (error: Error) => {
      logger.error('Stream manager error:', error);
    });
    
    // Handle connection events
    this.streamManager.on('connected', () => {
      logger.info('✅ gRPC stream connected');
    });
    
    this.streamManager.on('disconnected', () => {
      logger.warn('⚠️ gRPC stream disconnected');
    });
  }
  
  async start(): Promise<void> {
    logger.info('🚀 Starting gRPC Stream Application v4.23 with Holder Analytics...');
    
    try {
      // Initialize services
      await this.initializeServices();
      
      // Start the stream manager
      await this.streamManager.start();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('✅ gRPC Stream Application v4.23 started successfully');
      
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }
  
  private async initializeServices(): Promise<void> {
    // Test database connection
    const dbTest = await db.raw('SELECT NOW()');
    logger.info('✅ Database connected:', dbTest.rows[0].now);
    
    // Check TimescaleDB
    const tsCheck = await db.raw(`
      SELECT default_version, installed_version
      FROM pg_available_extensions
      WHERE name = 'timescaledb'
    `);
    logger.info('✅ TimescaleDB version:', tsCheck.rows[0]?.installed_version || 'Not installed');

    // NEW: Check holder analytics columns
    const holderColumnsCheck = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('top_25_percent', 'holder_distribution', 'holder_data_source', 'holder_last_updated')
    `);
    const hasHolderColumns = holderColumnsCheck.rows.length === 4;
    logger.info(`✅ Holder analytics columns: ${hasHolderColumns ? 'Present' : 'Missing - run migration'}`);
    
    // Initialize SOL price service
    await SOL_PRICE_SERVICE.initialize();
    logger.info('✅ SOL price service initialized');
    
    // Initialize Shyft metadata service
    logger.info('✅ Shyft metadata service initialized');

    // NEW: Initialize holder analytics service
    await HOLDER_ANALYTICS_SERVICE.start();
    logger.info('✅ Holder analytics service initialized');
    
    // Fix missing metadata on startup (after delay)
    setTimeout(async () => {
      try {
        logger.info('🔧 Starting initial metadata fix...');
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(100);
        logger.info(`✅ Fixed metadata for ${fixed} tokens on startup`);
      } catch (error) {
        logger.error('Error during startup metadata fix:', error);
      }
    }, 30000); // After 30 seconds

    // NEW: Queue high-priority tokens for holder analysis
    setTimeout(async () => {
      try {
        logger.info('📊 Starting initial holder analytics...');
        await HOLDER_ANALYTICS_SERVICE.queueTokensByCategory();
        logger.info('✅ Queued tokens for initial holder analysis');
      } catch (error) {
        logger.error('Error during startup holder analysis:', error);
      }
    }, 45000); // After 45 seconds
    
    // Initialize WebSocket service if enabled
    if (config.WEBSOCKET_ENABLED) {
      this.wsService = new WebSocketService(config.WEBSOCKET_PORT || 8080);
      await this.wsService.start();
      logger.info('✅ WebSocket service started');
    }
  }
  
  private startPeriodicTasks(): void {
    // ENHANCED: Stats display with holder analytics
    this.statsInterval = setInterval(async () => {
      const stats = this.streamManager.getStats();
      const metadataStats = HELIUS_METADATA_SERVICE.getStats();
      const holderStats = HOLDER_ANALYTICS_SERVICE.getStats(); // NEW

      // NEW: Get holder analytics summary
      const holderSummary = await db.raw('SELECT * FROM get_holder_analytics_stats()');
      
      logger.info('📊 Stream Statistics:', {
        pricesProcessed: stats.pricesProcessed,
        transactionsProcessed: stats.transactionsProcessed,
        newTokensDiscovered: stats.newTokensDiscovered,
        buysDetected: stats.buysDetected,
        sellsDetected: stats.sellsDetected,
        errors: stats.errors,
        buffers: stats.bufferSizes,
        lastFlush: stats.lastFlush,
        metadata: {
          processing: metadataStats.processingQueue,
          retrying: metadataStats.retryQueue,
          requestDelay: metadataStats.requestDelay
        },
        holderAnalytics: { // NEW
          processing: holderStats.processingQueue,
          retrying: holderStats.retryQueue,
          requestDelay: holderStats.requestDelay
        }
      });

      // NEW: Log holder analytics summary
      if (holderSummary.rows.length > 0) {
        logger.info('📊 Holder Analytics Summary:', holderSummary.rows);
      }
      
      // Broadcast stats to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('stats', {
          ...stats,
          metadata: metadataStats,
          holderAnalytics: holderStats, // NEW
          holderSummary: holderSummary.rows // NEW
        });
      }
    }, 30000); // Every 30 seconds
    
    // Periodic metadata fixing (every 15 minutes)
    this.metadataFixInterval = setInterval(async () => {
      try {
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(25);
        if (fixed > 0) {
          logger.info(`🔄 Periodic metadata fix: ${fixed} tokens updated`);
        }
      } catch (error) {
        logger.error('Error during periodic metadata fix:', error);
      }
    }, 15 * 60 * 1000); // Every 15 minutes

    // NEW: Periodic holder analytics (every 3 minutes for AIM tokens)
    this.holderAnalyticsInterval = setInterval(async () => {
      try {
        await HOLDER_ANALYTICS_SERVICE.queueTokensByCategory();
        logger.info('🔄 Periodic holder analytics refresh queued');
      } catch (error) {
        logger.error('Error during periodic holder analytics:', error);
      }
    }, 3 * 60 * 1000); // Every 3 minutes (fastest update cycle)
    
    // ENHANCED: Health check with holder analytics
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        
        if (!health.healthy) {
          logger.error('❌ Health check failed:', health);
          
          // Attempt recovery
          if (!health.grpcConnected) {
            logger.info('Attempting to reconnect gRPC...');
          }

          // NEW: Restart holder analytics if unhealthy
          if (!health.holderAnalyticsHealthy) {
            logger.info('Restarting holder analytics service...');
            try {
              await HOLDER_ANALYTICS_SERVICE.stop();
              await HOLDER_ANALYTICS_SERVICE.start();
            } catch (error) {
              logger.error('Failed to restart holder analytics service:', error);
            }
          }
        }
      } catch (error) {
        logger.error('Health check error:', error);
      }
    }, 60000); // Every minute
  }
  
  private async checkHealth(): Promise<any> {
    const stats = this.streamManager.getStats();
    const metadataStats = HELIUS_METADATA_SERVICE.getStats();
    const holderStats = HOLDER_ANALYTICS_SERVICE.getStats(); // NEW
    
    // Check database
    let dbHealthy = true;
    try {
      await db.raw('SELECT 1');
    } catch (error) {
      dbHealthy = false;
    }
    
    // Check data freshness
    const timeSinceLastFlush = Date.now() - stats.lastFlush.getTime();
    const dataFresh = timeSinceLastFlush < 60000; // Less than 1 minute
    
    // Check metadata service health
    const metadataHealthy = metadataStats.processingQueue < 100 && metadataStats.retryQueue < 50;

    // NEW: Check holder analytics service health
    const holderAnalyticsHealthy = holderStats.processingQueue < 50 && holderStats.retryQueue < 25;
    
    const healthy = dbHealthy && stats.grpcConnected && dataFresh && metadataHealthy && holderAnalyticsHealthy;
    
    return {
      healthy,
      dbHealthy,
      grpcConnected: stats.grpcConnected,
      dataFresh,
      metadataHealthy,
      holderAnalyticsHealthy, // NEW
      timeSinceLastFlush,
      errors: stats.errors,
      metadata: metadataStats,
      holderAnalytics: holderStats // NEW
    };
  }
  
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      try {
        // Stop periodic tasks
        if (this.statsInterval) {
          clearInterval(this.statsInterval);
        }
        
        if (this.healthCheckInterval) {
          clearInterval(this.healthCheckInterval);
        }
        
        if (this.metadataFixInterval) {
          clearInterval(this.metadataFixInterval);
        }

        // NEW: Stop holder analytics interval
        if (this.holderAnalyticsInterval) {
          clearInterval(this.holderAnalyticsInterval);
        }
        
        // Stop stream manager
        await this.streamManager.stop();

        // NEW: Stop holder analytics service
        await HOLDER_ANALYTICS_SERVICE.stop();
        
        // Stop WebSocket service
        if (this.wsService) {
          await this.wsService.stop();
        }
        
        // Close database pool
        await db.destroy();
        
        logger.info('✅ Shutdown complete');
        process.exit(0);
        
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }
  
  // Method to manually trigger metadata fix
  async fixMissingMetadata(limit: number = 50): Promise<number> {
    try {
      logger.info(`🔧 Manually triggering metadata fix for ${limit} tokens...`);
      const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(limit);
      logger.info(`✅ Manual metadata fix complete: ${fixed} tokens updated`);
      return fixed;
    } catch (error) {
      logger.error('Error during manual metadata fix:', error);
      return 0;
    }
  }

  // NEW: Enhanced method to manually trigger holder analytics
  async updateHoldersForToken(tokenAddress: string): Promise<any> {
    try {
      logger.info(`🔍 Manually updating holders for ${tokenAddress}`);
      const result = await HOLDER_ANALYTICS_SERVICE.forceUpdateHolders(tokenAddress);
      logger.info(`✅ Manual holder update complete for ${tokenAddress}`);
      return result;
    } catch (error) {
      logger.error('Error during manual holder update:', error);
      return null;
    }
  }
  
  // ENHANCED: Get comprehensive system status
  async getSystemStatus() {
    const streamStats = this.streamManager.getStats();
    const metadataStats = HELIUS_METADATA_SERVICE.getStats();
    const holderStats = HOLDER_ANALYTICS_SERVICE.getStats(); // NEW
    const holderSummary = await HOLDER_ANALYTICS_SERVICE.getHolderSummary(10); // NEW
    
    return {
      stream: streamStats,
      metadata: metadataStats,
      holderAnalytics: holderStats, // NEW
      holderSummary: holderSummary, // NEW
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
  
  // Queue specific token for metadata fetch
  queueTokenForMetadata(tokenAddress: string): void {
    HELIUS_METADATA_SERVICE.queueTokenForMetadata(tokenAddress);
    logger.info(`📝 Manually queued metadata fetch: ${tokenAddress.substring(0, 8)}...`);
  }

  // NEW: Queue specific token for holder analysis
  queueTokenForHolderAnalysis(tokenAddress: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'): void {
    HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(tokenAddress, priority);
    logger.info(`📊 Manually queued holder analysis: ${tokenAddress.substring(0, 8)}... (${priority})`);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new GrpcStreamApplication();
  
  app.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}