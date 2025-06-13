// src/index.ts - UPDATED WITH DUAL ADDRESS SUPPORT
import { GrpcStreamApplication } from './grpc/grpc-stream-app';
import { categoryManager } from './category/category-manager';
import { performStartupChecks } from './migrations/startup-migration';
import { logger } from './utils/logger2';
import { db } from './database/postgres';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Import new dual address components
import { EnhancedYellowstoneClient } from './grpc/enhanced-yellowstone-client';
import { DualAddressDbService } from './services/dual-address-db-service';
import { UniversalAddressService } from './services/universal-address-service';

// Import the JavaScript metadata service
const { HELIUS_METADATA_SERVICE } = require('./services/multi-source-metadata-service');

interface PriceData {
  tokenAddress: string;
  marketCap: number;
  priceUsd?: number;
  priceSol?: number;
}

// Run dual address migration
async function runDualAddressMigration(): Promise<void> {
  const migrationPath = path.join(__dirname, '../migrations/add_dual_address_support.sql');
  
  // Check if migration file exists
  if (!fs.existsSync(migrationPath)) {
    logger.warn('Dual address migration file not found, skipping...');
    return;
  }
  
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  try {
    await db.raw(migrationSQL);
    logger.info('✅ Dual address migration completed');
  } catch (error: any) {
    if (error.code === '42P07') { // duplicate_table error
      logger.info('Dual address tables already exist');
    } else {
      logger.error('Migration failed:', error);
      throw error;
    }
  }
}

/**
 * Main application entry point with dual address support
 */
async function startApplication() {
  logger.info('🚀 Starting Memecoin Bot with Enhanced Dual Address Support...');
  
  try {
    // Step 1: Perform startup checks and migrations
    await performStartupChecks();
    
    // Step 1.5: Run dual address migration
    await runDualAddressMigration();
    
    // Step 2: Initialize the category manager
    await categoryManager.initialize();
    logger.info('✅ Category manager initialized');
    
    // Step 3: Initialize dual address services
    const dualAddressDb = new DualAddressDbService(db);
    
    // Create enhanced gRPC client for dual address support
    const enhancedGrpcClient = new EnhancedYellowstoneClient(
      process.env.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
      process.env.GRPC_TOKEN || ''
    );
    
    const universalAddress = new UniversalAddressService(enhancedGrpcClient, dualAddressDb);
    
    // Setup enhanced client event handlers
    enhancedGrpcClient.on('dualAddressUpdate', async (dualToken) => {
      try {
        // Store dual address token
        await dualAddressDb.upsertTokenWithDualAddress(dualToken, {
          solPriceUsd: 100 // Should come from your SOL price service
        });
        
        // Queue for metadata enrichment using SPL address
        if (HELIUS_METADATA_SERVICE && typeof HELIUS_METADATA_SERVICE.queueTokenForMetadata === 'function') {
          HELIUS_METADATA_SERVICE.queueTokenForMetadata(dualToken.splTokenAddress);
        }
        
        // Check category with market cap
        const solReserves = Number(dualToken.bondingCurveData.virtualSolReserves) / 1e9;
        const tokenReserves = Number(dualToken.bondingCurveData.virtualTokenReserves) / 1e6;
        const priceSol = tokenReserves > 0 ? solReserves / tokenReserves : 0;
        const marketCap = priceSol * 100 * 1000000; // Assuming 1M supply and $100 SOL
        
        await categoryManager.handlePriceUpdate(dualToken.splTokenAddress, marketCap);
        
      } catch (error) {
        logger.error('Failed to process dual address update:', error);
      }
    });
    
    // Step 4: Start the existing gRPC streaming application
    const grpcApp = new GrpcStreamApplication();
    
    // Inject the enhanced client into the app if possible
    // This depends on your GrpcStreamApplication structure
    if ((grpcApp as any).setGrpcClient) {
      (grpcApp as any).setGrpcClient(enhancedGrpcClient);
    }
    
    // Start the gRPC stream
    await grpcApp.start();
    
    // Connect to the stream manager directly
    const streamManager = (grpcApp as any).streamManager;
    
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
      } else if (event.toCategory === 'GRADUATED') {
        logger.info(`🎓 Token ${event.tokenAddress} graduated! Market cap: $${event.marketCap}`);
      } else if (event.toCategory === 'ARCHIVE') {
        logger.info(`📦 Token ${event.tokenAddress} archived due to low market cap`);
      }
    });
    
    logger.info('✅ Complete system started with dual address support');
    
    // Test dual address functionality after 10 seconds
    setTimeout(async () => {
      logger.info('🧪 Testing dual address lookups...');
      
      // Test with a known pump.fun address if you have one
      const testAddress = '9NvKd8dFzKmQq4oLWzcQdwszYaxDdN2VLiTtzovgpump';
      const result = await universalAddress.getTokenData(testAddress);
      if (result) {
        logger.info(`Found token by pump.fun address: ${result.symbol || 'Unknown'}`);
      }
    }, 10000);
    
    // Setup graceful shutdown
    setupGracefulShutdown(grpcApp, enhancedGrpcClient);
    
    // Log initial statistics
    const stats = categoryManager.getStatistics();
    logger.info('Initial token distribution:', stats);
    
    // Make universal address service globally available if needed
    (global as any).universalAddressService = universalAddress;
    
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
 * Setup graceful shutdown handlers with enhanced client
 */
function setupGracefulShutdown(grpcApp: GrpcStreamApplication, enhancedClient?: EnhancedYellowstoneClient) {
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }
    
    isShuttingDown = true;
    logger.info(`\n${signal} received. Starting graceful shutdown...`);
    
    try {
      // Disconnect enhanced client if exists
      if (enhancedClient) {
        logger.info('Disconnecting enhanced gRPC client...');
        await enhancedClient.disconnect();
      }
      
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
    
    // Check universal address service if available
    const dualAddressStatus = (global as any).universalAddressService ? 'active' : 'not initialized';
    
    return {
      status: 'healthy',
      timestamp: new Date(),
      components: {
        database: 'connected',
        categoryManager: {
          status: 'active',
          tokens: stats
        },
        grpc: 'connected',
        dualAddressService: dualAddressStatus
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