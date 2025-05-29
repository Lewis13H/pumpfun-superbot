// src/index.ts - Updated with WebSocket support
import { createServer } from 'http';
import { app } from './server';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './database/postgres';
import { closeQuestDB } from './database/questdb';
import { discoveryService } from './discovery/discovery-service';
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

async function bootstrap() {
  try {
    logger.info('Starting Solana Token Discovery System...');
    
    // Initialize discovery service
    await discoveryService.initialize();
    
    // Start HTTP server with WebSocket support
    httpServer.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info('WebSocket server initialized');
    });
    
    // Set up WebSocket event emitters for discovery service
    setupDiscoveryWebSocketEvents();
    
    // Auto-start discovery if in development
    if (config.env === 'development') {
      setTimeout(async () => {
        logger.info('Auto-starting discovery service...');
        await discoveryService.start();
      }, 5000);
    }
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      
      await discoveryService.stop();
      
      httpServer.close(async () => {
        await db.destroy();
        await closeQuestDB();
        process.exit(0);
      });
    });
    
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}

function setupDiscoveryWebSocketEvents() {
  // Get discovery manager from service
  const discoveryManager = (discoveryService as any).discoveryManager;
  
  if (discoveryManager) {
    // Emit new tokens via WebSocket
    discoveryManager.on('tokenDiscovered', (token: any) => {
      io.to('tokens').emit('new-token', {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.createdAt,
        discoveredAt: new Date()
      });
    });
  }

  // Emit stats updates every 5 seconds
  setInterval(() => {
    const stats = discoveryService.getStats();
    io.to('discovery-stats').emit('discovery-stats', {
      type: 'stats',
      stats
    });
  }, 5000);

  // Get token processor and emit updates
  const tokenProcessor = (discoveryService as any).tokenProcessor;
  if (tokenProcessor) {
    tokenProcessor.on('tokenReady', async (token: any) => {
      // Emit token update via WebSocket
      io.to('tokens').emit('token-update', {
        address: token.address,
        status: 'analyzed'
      });
    });
  }
}

bootstrap();