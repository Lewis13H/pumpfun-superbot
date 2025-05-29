// src/discovery/discovery-service.ts
import { logger } from '../utils/logger';
import { FilteredDiscoveryManager } from './filtered-discovery-manager';
import { EnhancedPumpFunMonitor as PumpFunMonitor } from './pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { EnhancedTokenProcessor } from './enhanced-token-processor';
import { db } from '../database/postgres';

class DiscoveryService {
  private discoveryManager: FilteredDiscoveryManager;
  private tokenProcessor: EnhancedTokenProcessor;
  private isRunning: boolean = false;

  constructor() {
    this.discoveryManager = new FilteredDiscoveryManager();
    this.tokenProcessor = new EnhancedTokenProcessor();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Discovery Service with Smart Filtering...');
    
    await this.discoveryManager.initialize();
    // TokenProcessor doesn't have initialize method, so skip it
    
    // Connect components
    this.discoveryManager.on('tokenDiscovered', async (tokenData) => {
      logger.info(`Processing active token: ${tokenData.symbol} with MC=$${tokenData.marketData?.marketCap || 0}`);
      // Use addToken instead of queueToken
      await this.tokenProcessor.addToken(tokenData, 80); // High priority for filtered tokens
    });
    
    // Register monitors
    const pumpFunMonitor = new PumpFunMonitor();
    const raydiumMonitor = new RaydiumMonitor();
    
    this.discoveryManager.registerMonitor(pumpFunMonitor);
    this.discoveryManager.registerMonitor(raydiumMonitor);
    
    logger.info('Discovery Service initialized with filtering enabled');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Discovery Service already running');
      return;
    }

    logger.info('Starting Discovery Service...');
    this.isRunning = true;
    
    await this.discoveryManager.startAll();
    // TokenProcessor doesn't have start method, it's ready to process immediately
    
    logger.info('Discovery Service started - only tracking tokens that meet filter criteria');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Discovery Service...');
    this.isRunning = false;
    
    await this.discoveryManager.stopAll();
    // For TokenProcessor, we can clear the queue
    await this.tokenProcessor.clear();
    
    logger.info('Discovery Service stopped');
  }

  async updateFilter(filterName: string): Promise<void> {
    await this.discoveryManager.updateFilter(filterName);
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      discovery: this.discoveryManager.getStats(),
      processing: this.tokenProcessor.getStats()
    };
  }

  // Add missing methods for compatibility with server.ts
  async analyzeSpecificToken(address: string): Promise<any> {
    logger.info(`Analyzing specific token: ${address}`);
    
    try {
      // Get token from database
      const token = await db('tokens')
        .where('address', address)
        .first();
      
      if (!token) {
        throw new Error('Token not found');
      }
      
      // Queue for analysis using addToken
      await this.tokenProcessor.addToken({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.created_at,
        metadata: {}
      }, 90); // High priority
      
      return {
        success: true,
        message: 'Token queued for analysis',
        token
      };
    } catch (error) {
      logger.error(`Error analyzing token ${address}:`, error);
      throw error;
    }
  }

  async getTokenAnalysis(address: string): Promise<any> {
    try {
      const [token, metrics, signals] = await Promise.all([
        db('tokens').where('address', address).first(),
        db('enhanced_token_metrics').where('token_address', address).first(),
        db('token_signals').where('token_address', address).orderBy('generated_at', 'desc').limit(5)
      ]);
      
      if (!token) {
        return null;
      }
      
      return {
        token,
        metrics,
        signals
      };
    } catch (error) {
      logger.error(`Error getting token analysis:`, error);
      throw error;
    }
  }

  async getRecentAlerts(limit: number = 10): Promise<any[]> {
    try {
      // For now, return empty array or implement alert system
      return [];
    } catch (error) {
      logger.error('Error getting recent alerts:', error);
      return [];
    }
  }

  // Placeholder methods for analyzers
  getEnhancedAnalyzer(): any {
    // Return placeholder or null
    return null;
  }

  getMarketAnalyzer(): any {
    // Return placeholder or null
    return null;
  }
}

export const discoveryService = new DiscoveryService();

// If this file is run directly, start the discovery service
if (require.main === module) {
  async function main() {
    try {
      logger.info('🚀 Starting Discovery Service...');
      
      await discoveryService.initialize();
      await discoveryService.start();
      
      // Keep the process running
      process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down...');
        await discoveryService.stop();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down...');
        await discoveryService.stop();
        process.exit(0);
      });
      
      logger.info('✅ Discovery Service running! Press Ctrl+C to stop.');
      
    } catch (error) {
      logger.error('❌ Failed to start Discovery Service:', error);
      process.exit(1);
    }
  }
  
  main();
}