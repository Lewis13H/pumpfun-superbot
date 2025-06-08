import { TokenCategory } from '../config/category-config';
import { ScanTask, ScanResult } from './scan-task.interface';
import { CategoryAPIRouter } from '../analysis/category-api-router';
import { logger } from '../utils/logger2';

export class ScanHandlers {
  constructor(private apiRouter: CategoryAPIRouter) {}
  
  /**
   * Create scan handler for a category
   */
  createHandler(category: TokenCategory): (task: ScanTask) => Promise<ScanResult> {
    return async (task: ScanTask): Promise<ScanResult> => {
      const startTime = Date.now();
      
      try {
        // Determine if we need full or basic analysis
        const useFullAnalysis = category === 'AIM';
        
        // Perform analysis
        const analysis = await this.apiRouter.analyzeToken(
          task.tokenAddress,
          category,
          useFullAnalysis
        );
        
        return {
          tokenAddress: task.tokenAddress,
          success: true,
          marketCap: analysis.marketCap,
          duration: Date.now() - startTime,
          apisUsed: analysis.apisUsed,
        };
      } catch (error) {
        logger.error(`Scan failed for ${task.tokenAddress}:`, error);
        
        return {
          tokenAddress: task.tokenAddress,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: Date.now() - startTime,
          apisUsed: [],
        };
      }
    };
  }
  
  /**
   * Register all handlers
   */
  registerAll(scheduler: any): void {
    const categories: TokenCategory[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE'];
    
    categories.forEach(category => {
      scheduler.registerScanHandler(category, this.createHandler(category));
    });
    
    logger.info('Registered scan handlers for all categories');
  }
}

