// src/grpc/grpc-stream-app.ts

import { GrpcStreamManager } from './grpc-stream-manager';
import { db } from '../database/postgres';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
import { logger } from '../utils/logger';
import { config } from '../config';
import { WebSocketService } from '../websocket/websocket-service';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';

export class GrpcStreamApplication {
  private streamManager: GrpcStreamManager;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private wsService?: WebSocketService;
  private statsInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  
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
    this.streamManager.on('newToken', async (token) => {
      logger.info(`🎉 New token discovered: ${token.address}`);
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('newToken', token);
      }
    });
    
    // Handle buy signals
    this.streamManager.on('buySignal', async ({ token, signal }) => {
      logger.info(`💰 Buy signal for ${token.symbol}: ${signal.reason}`);
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('buySignal', { token, signal });
      }
      
      // Could trigger automated trading here
    });
    
    // Handle errors
    this.streamManager.on('error', (error) => {
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
    logger.info('🚀 Starting gRPC Stream Application...');
    
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
    logger.info('✅ TimescaleDB version:', tsCheck.rows[0].installed_version);
    
    // Initialize SOL price service
    await SOL_PRICE_SERVICE.initialize();
    logger.info('✅ SOL price service initialized');
    
    // Initialize WebSocket service if enabled
    if (config.WEBSOCKET_ENABLED) {
      this.wsService = new WebSocketService(config.WEBSOCKET_PORT || 8080);
      await this.wsService.start();
      logger.info('✅ WebSocket service started');
    }
  }
  
  private startPeriodicTasks(): void {
    // Stats display
    this.statsInterval = setInterval(() => {
      const stats = this.streamManager.getStats();
      
      logger.info('📊 Stream Statistics:', {
        pricesProcessed: stats.pricesProcessed,
        transactionsProcessed: stats.transactionsProcessed,
        newTokensDiscovered: stats.newTokensDiscovered,
        buysDetected: stats.buysDetected,
        sellsDetected: stats.sellsDetected,
        errors: stats.errors,
        buffers: stats.bufferSizes,
        lastFlush: stats.lastFlush
      });
      
      // Broadcast stats to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('stats', stats);
      }
    }, 30000); // Every 30 seconds
    
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
    
    const healthy = dbHealthy && stats.grpcConnected && dataFresh;
    
    return {
      healthy,
      dbHealthy,
      grpcConnected: stats.grpcConnected,
      dataFresh,
      timeSinceLastFlush,
      errors: stats.errors
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
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new GrpcStreamApplication();
  
  app.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}
