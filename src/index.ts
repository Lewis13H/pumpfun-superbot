import { app } from './server';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './database/postgres';
import { closeQuestDB } from './database/questdb';
import { discoveryService } from './discovery/discovery-service';
import { analysisService } from './analysis/analysis-service';

async function bootstrap() {
  try {
    logger.info('Starting Solana Token Discovery System...');
    
    // Initialize services
    await discoveryService.initialize();
    await analysisService.initialize();
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
    });
    
    // Auto-start services if in development
    if (config.env === 'development') {
      setTimeout(async () => {
        logger.info('Auto-starting services...');
        await discoveryService.start();
        await analysisService.start();
      }, 5000);
    }
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      
      await analysisService.stop();
      await discoveryService.stop();
      
      server.close(async () => {
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

bootstrap();