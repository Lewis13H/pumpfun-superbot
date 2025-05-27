// src/index.ts
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
    
    // Set up event handlers between services
    discoveryService.on('tokenReady', async (token) => {
      logger.info(`Token ready for analysis: ${token.symbol} (${token.address})`);
      await analysisService.analyzeToken(token);
    });
    
    analysisService.on('analysisComplete', (analysis) => {
      logger.info(`Analysis complete for ${analysis.symbol}`, {
        classification: analysis.classification,
        scores: analysis.scores,
      });
    });
    
    analysisService.on('analysisFailed', (token, error) => {
      logger.error(`Analysis failed for ${token.address}:`, error);
    });
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info(`API endpoints available:`);
      logger.info(`  - Health: http://localhost:${config.port}/health`);
      logger.info(`  - Discovery: http://localhost:${config.port}/discovery/stats`);
      logger.info(`  - Analysis: http://localhost:${config.port}/analysis/stats`);
      logger.info(`  - Tokens: http://localhost:${config.port}/tokens/list`);
      logger.info(`  - API Status: http://localhost:${config.port}/api/integrations/status`);
    });
    
    // Auto-start services if in development
    if (config.env === 'development') {
      setTimeout(async () => {
        logger.info('Auto-starting discovery and analysis services...');
        await discoveryService.start();
        await analysisService.start();
      }, 15000);
    }
    
    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      
      await discoveryService.stop();
      await analysisService.stop();
      
      server.close(async () => {
        await db.destroy();
        await closeQuestDB();
        process.exit(0);
      });
    });
    
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully...');
      
      await discoveryService.stop();
      await analysisService.stop();
      
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