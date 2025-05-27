import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { discoveryService } from '../discovery/discovery-service';
import { SimpleTokenAnalyzer } from './simple-analyzer';
import { TokenAnalysisStorage } from './analysis-storage';
import { TokenDiscovery } from '../discovery/base-monitor';
import { TokenAnalysis } from './base-analyzer';

export class AnalysisOrchestrator extends EventEmitter {
  private analyzer: SimpleTokenAnalyzer;
  private storage: TokenAnalysisStorage;
  private analysisQueue: PQueue;
  private isRunning: boolean = false;
  
  private stats = {
    totalAnalyzed: 0,
    successfulAnalysis: 0,
    partialAnalysis: 0,
    failedAnalysis: 0,
    totalRetries: 0,
  };

  constructor() {
    super();
    this.analyzer = new SimpleTokenAnalyzer();
    this.storage = new TokenAnalysisStorage();
    
    // Analysis queue with concurrency control
    this.analysisQueue = new PQueue({
      concurrency: 5, // Analyze 5 tokens in parallel
      timeout: 60000, // 60 second timeout per analysis
      throwOnTimeout: true,
    });

    this.setupQueueHandlers();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Analysis Orchestrator');
    
    // Set up event handlers to receive tokens from discovery
    const tokenProcessor = (discoveryService as any).tokenProcessor;
    
    tokenProcessor.on('tokenReady', async (token: TokenDiscovery) => {
      await this.queueTokenForAnalysis(token);
    });

    logger.info('Analysis Orchestrator initialized');
  }

  private setupQueueHandlers(): void {
    this.analysisQueue.on('active', () => {
      logger.debug(`Analysis queue active. Size: ${this.analysisQueue.size}, Pending: ${this.analysisQueue.pending}`);
    });

    this.analysisQueue.on('idle', () => {
      logger.debug('Analysis queue idle');
      this.emit('queueIdle');
    });

    this.analysisQueue.on('error', (error) => {
      logger.error('Analysis queue error:', error);
    });
  }

  async queueTokenForAnalysis(token: TokenDiscovery, priority: number = 50): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Analysis orchestrator not running, dropping token');
      return;
    }

    try {
      await this.analysisQueue.add(
        async () => this.analyzeToken(token),
        { priority }
      );
    } catch (error) {
      logger.error(`Failed to queue token ${token.address} for analysis:`, error);
    }
  }

  private async analyzeToken(token: TokenDiscovery, retryCount: number = 0): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check if already analyzed recently
      const recentAnalysis = await this.storage.getRecentAnalysis(token.address, 300000); // 5 minutes
      if (recentAnalysis) {
        logger.debug(`Token ${token.address} was analyzed recently, skipping`);
        return;
      }

      // Perform analysis
      const analysis = await this.analyzer.analyze(token);
      
      // Update statistics
      this.stats.totalAnalyzed++;
      switch (analysis.status) {
        case 'success':
          this.stats.successfulAnalysis++;
          break;
        case 'partial':
          this.stats.partialAnalysis++;
          break;
        case 'failed':
          this.stats.failedAnalysis++;
          break;
      }

      // Store analysis results
      await this.storage.storeAnalysis(analysis);

      // Update token record with scores
      await this.storage.updateTokenScores(analysis);

      // Emit analysis complete event
      this.emit('analysisComplete', analysis);

      const duration = Date.now() - startTime;
      logger.info(`Analysis stored for ${token.symbol}: Status=${analysis.status}, Score=${analysis.scores.overallScore}, Duration=${duration}ms`);

      // If analysis was partial or failed, maybe retry later
      if (analysis.status !== 'success' && retryCount < 3) {
        setTimeout(() => {
          this.stats.totalRetries++;
          this.analyzeToken(token, retryCount + 1);
        }, 300000); // Retry after 5 minutes
      }

    } catch (error) {
      logger.error(`Failed to analyze token ${token.address}:`, error);
      this.stats.failedAnalysis++;
      
      // Emit error event
      this.emit('analysisError', { token, error });
      
      // Retry logic
      if (retryCount < 3) {
        const retryDelay = (retryCount + 1) * 60000; // Exponential backoff
        logger.info(`Scheduling retry for ${token.address} in ${retryDelay / 1000}s`);
        
        setTimeout(() => {
          this.stats.totalRetries++;
          this.analyzeToken(token, retryCount + 1);
        }, retryDelay);
      }
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Analysis Orchestrator already running');
      return;
    }

    logger.info('Starting Analysis Orchestrator');
    this.isRunning = true;
    
    // Start periodic tasks
    this.startPeriodicTasks();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Analysis Orchestrator not running');
      return;
    }

    logger.info('Stopping Analysis Orchestrator');
    this.isRunning = false;
    
    // Clear the queue
    this.analysisQueue.clear();
    
    // Wait for pending analyses
    await this.analysisQueue.onIdle();
    
    logger.info('Analysis Orchestrator stopped');
  }

  private startPeriodicTasks(): void {
    // Re-analyze high-value tokens periodically
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const topTokens = await this.storage.getTopTokensForReanalysis(10);
        for (const token of topTokens) {
          await this.queueTokenForAnalysis({
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            platform: token.platform,
            createdAt: new Date(token.created_at),
          }, 30); // Lower priority for re-analysis
        }
      } catch (error) {
        logger.error('Error in periodic reanalysis:', error);
      }
    }, 600000); // Every 10 minutes
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.analysisQueue.size,
      pending: this.analysisQueue.pending,
      isRunning: this.isRunning,
      successRate: this.stats.totalAnalyzed > 0 
        ? (this.stats.successfulAnalysis / this.stats.totalAnalyzed * 100).toFixed(2) + '%'
        : '0%',
    };
  }
}