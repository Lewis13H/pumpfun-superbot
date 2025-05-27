import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { TokenAnalyzer } from './token-analyzer';
import { db } from '../database/postgres';
import { TokenDiscovery } from '../discovery/base-monitor';
import { discoveryService } from '../discovery/discovery-service';

export class AnalysisService {
  private analyzer: TokenAnalyzer;
  private analysisQueue: PQueue;
  private isRunning: boolean = false;
  private stats = {
    analyzed: 0,
    failed: 0,
    skipped: 0,
    inProgress: 0
  };

  constructor() {
    this.analyzer = new TokenAnalyzer();
    
    // Create analysis queue with concurrency control
    this.analysisQueue = new PQueue({
      concurrency: 2, // Reduced from 5 to 2
      interval: 2000, // Increased from 1000 to 2000ms
      intervalCap: 3, // Reduced from 10 to 3 per interval
      timeout: 60000, // 60 second timeout per analysis
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Listen for tokens ready for analysis from discovery service
    const tokenProcessor = (discoveryService as any).tokenProcessor;
    if (tokenProcessor) {
      tokenProcessor.on('tokenReady', (token: TokenDiscovery) => {
        this.queueTokenForAnalysis(token);
      });
    }

    // Handle analysis completion
    this.analyzer.on('analysisComplete', (analysis) => {
      logger.info(`Analysis complete for ${analysis.symbol}: Score ${analysis.compositeScore.toFixed(3)}, Classification: ${analysis.classification}`);
      this.stats.analyzed++;
    });

    // Queue events
    this.analysisQueue.on('active', () => {
      this.stats.inProgress = this.analysisQueue.pending + this.analysisQueue.size;
    });
  }

  async queueTokenForAnalysis(token: TokenDiscovery, priority: number = 50): Promise<void> {
    if (!this.isRunning) {
      logger.debug('Analysis service not running, skipping token');
      this.stats.skipped++;
      return;
    }

    try {
      await this.analysisQueue.add(
        async () => {
          try {
            await this.analyzer.analyzeToken(token.address);
          } catch (error: any) {
            logger.error(`Analysis failed for ${token.symbol}:`, error.message);
            this.stats.failed++;
            
            // Update token status to failed
            await db('tokens')
              .where('address', token.address)
              .update({
                analysis_status: 'FAILED',
                updated_at: new Date()
              });
          }
        },
        { priority }
      );
    } catch (error) {
      logger.error('Failed to queue token for analysis:', error);
      this.stats.skipped++;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Analysis service already running');
      return;
    }

    logger.info('Starting analysis service');
    this.isRunning = true;

    // Start processing pending tokens
    await this.processPendingTokens();

    // Schedule periodic processing of pending tokens
    setInterval(() => {
      if (this.isRunning) {
        this.processPendingTokens();
      }
    }, 60000); // Every minute
  }

  async stop(): Promise<void> {
    logger.info('Stopping analysis service');
    this.isRunning = false;

    // Clear the queue
    this.analysisQueue.clear();
    
    // Wait for current analyses to complete
    await this.analysisQueue.onIdle();
  }

  private async processPendingTokens(): Promise<void> {
    try {
      // Get tokens that need analysis
      const pendingTokens = await db('tokens')
        .select('address', 'symbol', 'name', 'platform', 'created_at')
        .where('analysis_status', 'PENDING')
        .orderBy('discovered_at', 'desc')
        .limit(50);

      if (pendingTokens.length === 0) {
        return;
      }

      logger.info(`Found ${pendingTokens.length} tokens pending analysis`);

      for (const token of pendingTokens) {
        const discovery: TokenDiscovery = {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          platform: token.platform,
          createdAt: token.created_at,
        };

        // Calculate priority based on age
        const ageMinutes = (Date.now() - new Date(token.created_at).getTime()) / 60000;
        let priority = 50;
        if (ageMinutes < 60) priority = 70;
        if (ageMinutes < 30) priority = 80;
        if (ageMinutes < 10) priority = 90;

        await this.queueTokenForAnalysis(discovery, priority);
      }
    } catch (error) {
      logger.error('Error processing pending tokens:', error);
    }
  }

  async reanalyzeToken(address: string): Promise<void> {
    try {
      const token = await db('tokens')
        .select('address', 'symbol', 'name', 'platform', 'created_at')
        .where('address', address)
        .first();

      if (!token) {
        throw new Error('Token not found');
      }

      const discovery: TokenDiscovery = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.created_at,
      };

      await this.queueTokenForAnalysis(discovery, 100); // High priority
    } catch (error) {
      logger.error(`Failed to reanalyze token ${address}:`, error);
      throw error;
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.analysisQueue.size,
      pending: this.analysisQueue.pending,
      isRunning: this.isRunning,
      analyzerStatus: this.analyzer.getStatus()
    };
  }
}

// Export singleton instance
export const analysisService = new AnalysisService();