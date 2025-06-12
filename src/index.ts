import { GrpcStreamApplication } from './grpc/grpc-stream-app';
import { categoryManager } from './category/category-manager';
import { performStartupChecks } from './migrations/startup-migration';
import { logger } from './utils/logger';
import { db } from './database/postgres';

interface PriceData {
  tokenAddress: string;
  marketCap: number;
  priceUsd?: number;
  priceSol?: number;
}

/**
 * Main application entry point with proper initialization sequence
 */
async function startApplication() {
  logger.info('🚀 Starting Memecoin Bot with gRPC Streaming...');
  
  try {
    // Step 1: Perform startup checks and migrations
    await performStartupChecks();
    
    // Step 2: Initialize the category manager
    await categoryManager.initialize();
    logger.info('✅ Category manager initialized');
    
    // Step 3: Start the gRPC streaming application
    const grpcApp = new GrpcStreamApplication();
    
    // Start the gRPC stream
    await grpcApp.start();
    
    // Connect to the stream manager directly
    // Option 1: If GrpcStreamApplication has a public streamManager property
    const streamManager = (grpcApp as any).streamManager;
    
    // Option 2: If it has a getStreamManager method
    if (!streamManager && typeof (grpcApp as any).getStreamManager === 'function') {
      const sm = (grpcApp as any).getStreamManager();
      if (sm) {
        connectStreamManager(sm);
      }
    } else if (streamManager) {
      connectStreamManager(streamManager);
    } else {
      logger.warn('Could not find streamManager on GrpcStreamApplication');
      logger.warn('Price updates will not be connected to CategoryManager');
    }
    
    // Listen for category changes
    categoryManager.on('categoryChange', (event) => {
      logger.info(`📊 Category change: ${event.tokenAddress} moved from ${event.fromCategory} to ${event.toCategory}`);
      
      // Handle special category transitions
      if (event.toCategory === 'AIM') {
        logger.info(`🎯 Token ${event.tokenAddress} entered AIM category! Evaluate for trading.`);
        // Trigger buy signal evaluation
      } else if (event.toCategory === 'GRADUATED') {
        logger.info(`🎓 Token ${event.tokenAddress} graduated! Market cap: $${event.marketCap}`);
        // Handle graduation event
      } else if (event.toCategory === 'ARCHIVE') {
        logger.info(`📦 Token ${event.tokenAddress} archived due to low market cap`);
        // Clean up resources for archived token
      }
    });
    
    logger.info('✅ Complete system started successfully');
    
    // Setup graceful shutdown
    setupGracefulShutdown(grpcApp);
    
    // Log initial statistics
    const stats = categoryManager.getStatistics();
    logger.info('Initial token distribution:', stats);
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

/**
 * Connect stream manager events to category manager
 */
function connectStreamManager(streamManager: any) {
  if (streamManager && typeof streamManager.on === 'function') {
    logger.info('✅ Connecting stream manager to category manager');
    
    streamManager.on('priceUpdate', async (priceData: PriceData) => {
      try {
        await categoryManager.handlePriceUpdate(
          priceData.tokenAddress,
          priceData.marketCap
        );
      } catch (error) {
        logger.error('Error handling price update:', error);
      }
    });
    
    streamManager.on('tokenCreated', (data: any) => {
      logger.info(`New token created: ${data.tokenAddress}`);
    });
    
    streamManager.on('error', (error: any) => {
      logger.error('Stream manager error:', error);
    });
  } else {
    logger.warn('Stream manager does not support event emission');
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(grpcApp: GrpcStreamApplication) {
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }
    
    isShuttingDown = true;
    logger.info(`\n${signal} received. Starting graceful shutdown...`);
    
    try {
      // Stop the gRPC application if method exists
      logger.info('Stopping gRPC stream...');
      if (typeof (grpcApp as any).stop === 'function') {
        await (grpcApp as any).stop();
      } else if (typeof (grpcApp as any).disconnect === 'function') {
        await (grpcApp as any).disconnect();
      } else if (typeof (grpcApp as any).close === 'function') {
        await (grpcApp as any).close();
      } else {
        logger.warn('GrpcStreamApplication does not have stop/disconnect/close method');
      }
      
      // Shutdown category manager
      logger.info('Shutting down category manager...');
      await categoryManager.shutdown();
      
      // Close database connections
      logger.info('Closing database connections...');
      await db.destroy();
      
      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  // Handle shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
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

/**
 * Health check endpoint (can be used for monitoring)
 */
export async function checkHealth() {
  try {
    // Check database
    await db.raw('SELECT 1');
    
    // Check category manager
    const stats = categoryManager.getStatistics();
    
    return {
      status: 'healthy',
      timestamp: new Date(),
      components: {
        database: 'connected',
        categoryManager: {
          status: 'active',
          tokens: stats
        },
        grpc: 'connected'
      }
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Health check failed:', errorMessage);
    return {
      status: 'unhealthy',
      timestamp: new Date(),
      error: errorMessage
    };
  }
}

// Start the application
if (require.main === module) {
  startApplication();
}

export { startApplication };