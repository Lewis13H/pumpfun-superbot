// src/index.ts - Updated with Token Enrichment and WebSocket support
import { createServer } from 'http';
import { app } from './api/server';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './database/postgres';
import { closeQuestDB } from './database/questdb';
import { discoveryService } from './discovery/discovery-service';
import { TokenEnrichmentService } from './analysis/token-enrichment-service';
import { Server as SocketIOServer } from 'socket.io';

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:3001", "http://localhost:3000"],
    methods: ["GET", "POST"]
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });

  // Handle subscriptions
  socket.on('subscribe', (channels: string[]) => {
    channels.forEach(channel => {
      socket.join(channel);
      logger.debug(`Client ${socket.id} joined channel: ${channel}`);
    });
  });

  socket.on('unsubscribe', (channels: string[]) => {
    channels.forEach(channel => {
      socket.leave(channel);
      logger.debug(`Client ${socket.id} left channel: ${channel}`);
    });
  });
});

// Export io for use in other modules
export { io };

// Global references for services
let tokenEnrichmentService: TokenEnrichmentService;

async function bootstrap() {
  try {
    logger.info('Starting Solana Token Discovery System...');
    
    // Initialize discovery service
    await discoveryService.initialize();
    
    // Initialize Token Enrichment Service
    tokenEnrichmentService = new TokenEnrichmentService();
    await tokenEnrichmentService.start();
    logger.info('Token Enrichment Service started');
    
    // Connect enrichment service to discovery manager
    const discoveryManager = (discoveryService as any).discoveryManager;
    if (discoveryManager) {
      discoveryManager.setEnrichmentService(tokenEnrichmentService);
      logger.info('Connected enrichment service to discovery manager');
    }
    
    // Start HTTP server with WebSocket support
    httpServer.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info('WebSocket server initialized');
    });
    
    // Set up WebSocket event emitters
    setupWebSocketEvents();
    
    // Auto-start discovery if in development
    if (config.env === 'development') {
      setTimeout(async () => {
        logger.info('Auto-starting discovery service...');
        await discoveryService.start();
      }, 5000);
    }
    
    // Set global references for API access
    (global as any).discoveryService = discoveryService;
    (global as any).tokenEnrichmentService = tokenEnrichmentService;
    
    // Log system status periodically
    setInterval(() => {
      const stats = {
        discovery: discoveryService.getStats(),
        enrichment: tokenEnrichmentService.getStats()
      };
      logger.info('System Status:', stats);
    }, 60000); // Every minute
    
    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}

function setupWebSocketEvents() {
  // Get discovery manager from service
  const discoveryManager = (discoveryService as any).discoveryManager;
  
  if (discoveryManager) {
    // Emit new tokens via WebSocket
    discoveryManager.on('tokenDiscovered', (token: any) => {
      const tokenData = {
        address: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        platform: token.platform,
        createdAt: token.createdAt,
        discoveredAt: new Date(),
        marketCap: token.metadata?.marketCap || 0,
        needsEnrichment: true
      };
      
      io.to('tokens').emit('new-token', tokenData);
      logger.debug(`Emitted new token via WebSocket: ${token.symbol} (${token.address})`);
    });
  }

  // Token enrichment events
  if (tokenEnrichmentService) {
    tokenEnrichmentService.on('tokenEnriched', (enrichedData: any) => {
      io.to('tokens').emit('token-enriched', {
        address: enrichedData.address,
        marketCap: enrichedData.marketCap,
        price: enrichedData.price,
        liquidity: enrichedData.liquidity,
        volume24h: enrichedData.volume24h,
        enrichedAt: new Date()
      });
      logger.debug(`Emitted enriched token data: ${enrichedData.address}`);
    });
  }

  // Emit stats updates every 5 seconds
  setInterval(() => {
    const stats = {
      discovery: discoveryService.getStats(),
      enrichment: tokenEnrichmentService.getStats()
    };
    
    io.to('discovery-stats').emit('discovery-stats', {
      type: 'stats',
      stats,
      timestamp: new Date()
    });
  }, 5000);

  // Get token processor and emit updates
  const tokenProcessor = (discoveryService as any).tokenProcessor;
  if (tokenProcessor) {
    tokenProcessor.on('tokenReady', async (token: any) => {
      // Emit token update via WebSocket
      io.to('tokens').emit('token-update', {
        address: token.address,
        status: 'analyzed',
        analysisComplete: true
      });
    });

    tokenProcessor.on('analysisProgress', (progress: any) => {
      io.to('analysis-progress').emit('analysis-progress', progress);
    });
  }
}

async function gracefulShutdown() {
  logger.info('Shutdown signal received, shutting down gracefully...');
  
  try {
    // Stop discovery service
    await discoveryService.stop();
    logger.info('Discovery service stopped');
    
    // Stop token enrichment service
    if (tokenEnrichmentService) {
      await tokenEnrichmentService.stop();
      logger.info('Token enrichment service stopped');
    }
    
    // Close HTTP server
    httpServer.close(async () => {
      logger.info('HTTP server closed');
      
      // Close database connections
      await db.destroy();
      await closeQuestDB();
      logger.info('Database connections closed');
      
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the application
bootstrap();