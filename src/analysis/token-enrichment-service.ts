import { EventEmitter } from 'events';
import { logger } from '../utils/logger2';
import { db } from '../database/postgres';
import { TokenCategory, categoryConfig } from '../config/category-config';
import { categoryAPIRouter } from './category-api-router';
import { scanScheduler } from '../category/scan-scheduler';
import { ScanTask, ScanResult } from '../category/scan-task.interface';

export class TokenEnrichmentService extends EventEmitter {
  private isRunning: boolean = false;
  
  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('Starting Token Enrichment Service (Category-based)...');
    this.isRunning = true;

    // Register scan handlers for each category
    this.registerScanHandlers();
    
    // Start monitoring for AIM upgrades
    this.startAimUpgradeMonitoring();
    
    logger.info('Token Enrichment Service started');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Token Enrichment Service stopped');
  }

  /**
   * Register scan handlers with the scheduler
   */
  private registerScanHandlers(): void {
    const categories: TokenCategory[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE'];
    
    categories.forEach(category => {
      scanScheduler.registerScanHandler(category, async (task: ScanTask) => {
        return await this.performCategoryScan(task);
      });
    });
    
    logger.info('Registered enrichment handlers for all categories');
  }

  /**
   * Perform scan for a task
   */
  private async performCategoryScan(task: ScanTask): Promise<ScanResult> {
    const startTime = Date.now();
    
    try {
      // Use category-based API router
      const useFullAnalysis = task.category === 'AIM';
      const analysis = await categoryAPIRouter.analyzeToken(
        task.tokenAddress,
        task.category,
        useFullAnalysis
      );
      
      // Emit enrichment event
      this.emit('tokenEnriched', {
        address: task.tokenAddress,
        category: task.category,
        marketCap: analysis.marketCap,
        price: (analysis as any).price || 0,
        liquidity: analysis.liquidity,
        volume24h: analysis.volume24h,
        analysisType: analysis.analysisType,
      });
      
      return {
        tokenAddress: task.tokenAddress,
        success: true,
        marketCap: analysis.marketCap,
        duration: Date.now() - startTime,
        apisUsed: analysis.apisUsed,
      };
    } catch (error) {
      logger.error(`Enrichment failed for ${task.tokenAddress}:`, error);
      
      return {
        tokenAddress: task.tokenAddress,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        apisUsed: [],
      };
    }
  }

  /**
   * Monitor for tokens that should be upgraded to HIGH priority
   */
  private startAimUpgradeMonitoring(): void {
    setInterval(async () => {
      try {
        // Find HIGH tokens approaching AIM threshold
        const candidates = await db('tokens')
          .join('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
          .where('tokens.category', 'HIGH')
          .where('enhanced_token_metrics.market_cap', '>', 30000) // Close to $35k
          .select('tokens.address', 'tokens.symbol', 'enhanced_token_metrics.market_cap');
        
        for (const candidate of candidates) {
          logger.info(
            `🎯 ${candidate.symbol} approaching AIM zone: ${candidate.market_cap} (${
              ((candidate.market_cap / 35000) * 100).toFixed(1)
            }% to AIM)`
          );
        }
      } catch (error) {
        logger.error('Error in AIM upgrade monitoring:', error);
      }
    }, 60000); // Check every minute
  }

  /**
   * Get enrichment statistics
   */
  async getStats(): Promise<any> {
    const scanStats = scanScheduler.getStats();
    
    // Get tokens by last update time
    const staleTokens = await db('tokens')
      .whereNotIn('category', ['BIN', 'ARCHIVE'])
      .where('updated_at', '<', new Date(Date.now() - 30 * 60 * 1000)) // 30 minutes
      .count('* as count')
      .first();
    
    return {
      scanScheduler: scanStats,
      staleTokens: Number(staleTokens?.count) || 0,
      isRunning: this.isRunning,
    };
  }
}

// Export singleton instance
export const tokenEnrichmentService = new TokenEnrichmentService();

