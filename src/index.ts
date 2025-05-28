import { app } from './server';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './database/postgres';
import { closeQuestDB } from './database/questdb';
import { discoveryService } from './discovery/discovery-service';
import './api/server'; // Import API server

async function bootstrap() {
  try {
    logger.info('Starting Solana Token Discovery System...');
    
    // Initialize services
    await discoveryService.initialize();
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info('API Server is running');
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
    });
    
    // Auto-start services if in development
    if (config.env === 'development') {
      setTimeout(async () => {
        logger.info('Auto-starting discovery service...');
        await discoveryService.start();
      }, 5000);
    }
    
    // Graceful shutdown
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);
    
    async function handleShutdown() {
      logger.info('Shutdown signal received, shutting down gracefully...');
      
      // Stop services
      await discoveryService.stop();
      // await analysisService.stop(); // Will be enabled in Module 2A
      
      // Close server
      server.close(async () => {
        await db.destroy();
        await closeQuestDB();
        logger.info('Shutdown complete');
        process.exit(0);
      });
      
      // Force exit after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    }
    
  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
}

bootstrap();