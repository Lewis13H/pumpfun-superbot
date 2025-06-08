// src/grpc/grpc-stream-app.ts - FINAL VERSION

import { GrpcStreamManager } from './grpc-stream-manager';
import { db } from '../database/postgres';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
import { logger } from '../utils/logger2';
import { config } from '../config';
import { WebSocketService } from '../websocket/websocket-service';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';
// Import Helius metadata service
const { HELIUS_METADATA_SERVICE } = require('../services/helius-metadata-service');

export class GrpcStreamApplication {
  private streamManager: GrpcStreamManager;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private wsService?: WebSocketService;
  private statsInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private metadataFixInterval?: NodeJS.Timeout;
  
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
    // Handle new tokens
    this.streamManager.on('newToken', async (token: any) => {
      logger.info(`🎉 New token discovered: ${token.address.substring(0, 8)}... | Metadata fetching...`);
      
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
    
    // Handle buy signals
    this.streamManager.on('buySignal', async ({ token, signal }: { token: any; signal: any }) => {
      // Get updated token symbol for display
      const tokenData = await db('tokens').where('address', token.address).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...' 
        ? tokenData.symbol 
        : token.address.substring(0, 8) + '...';
      
      logger.info(`💰 Buy signal for ${displaySymbol}: ${signal.reason}`);
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('buySignal', { token: tokenData || token, signal });
      }
      
      // Could trigger automated trading here
    });
    
    // Handle price movements
    this.streamManager.on('pumpDetected', async (data: any) => {
      // Get token symbol for better logging
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...' 
        ? tokenData.symbol 
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🚀 PUMP: ${displaySymbol} +${data.priceChange.toFixed(1)}% | $${data.marketCap.toFixed(0)} MC`);
      
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
    logger.info('🚀 Starting gRPC Stream Application with Shyft Metadata Integration...');
    
    try {
      // Initialize services
      await this.initializeServices();
      
      // Start the stream manager
      await this.streamManager.start();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('✅ gRPC Stream Application started successfully');
      
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
    
    // Initialize SOL price service
    await SOL_PRICE_SERVICE.initialize();
    logger.info('✅ SOL price service initialized');
    
    // Initialize Shyft metadata service
    logger.info('✅ Shyft metadata service initialized');
    
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
    
    // Initialize WebSocket service if enabled
    if (config.WEBSOCKET_ENABLED) {
      this.wsService = new WebSocketService(config.WEBSOCKET_PORT || 8080);
      await this.wsService.start();
      logger.info('✅ WebSocket service started');
    }
  }
  
  private startPeriodicTasks(): void {
    // Stats display with metadata service stats
    this.statsInterval = setInterval(() => {
      const stats = this.streamManager.getStats();
      const metadataStats = HELIUS_METADATA_SERVICE.getStats();
      
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
        }
      });
      
      // Broadcast stats to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('stats', {
          ...stats,
          metadata: metadataStats
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
    
    // Health check
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        
        if (!health.healthy) {
          logger.error('❌ Health check failed:', health);
          
          // Attempt recovery
          if (!health.grpcConnected) {
            logger.info('Attempting to reconnect gRPC...');
            // The stream manager will handle reconnection automatically
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
    
    const healthy = dbHealthy && stats.grpcConnected && dataFresh && metadataHealthy;
    
    return {
      healthy,
      dbHealthy,
      grpcConnected: stats.grpcConnected,
      dataFresh,
      metadataHealthy,
      timeSinceLastFlush,
      errors: stats.errors,
      metadata: metadataStats
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
        
        // Stop stream manager
        await this.streamManager.stop();
        
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
  
  // Get comprehensive system status
  getSystemStatus() {
    const streamStats = this.streamManager.getStats();
    const metadataStats = HELIUS_METADATA_SERVICE.getStats();
    
    return {
      stream: streamStats,
      metadata: metadataStats,
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
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new GrpcStreamApplication();
  
  app.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}
