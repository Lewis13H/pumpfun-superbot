// src/discovery/enhanced-discovery-service.ts
import { DiscoveryManager } from './discovery-manager';
import { EnhancedTokenProcessor } from './enhanced-token-processor';
import { DeduplicationService } from './deduplication-service';
import { PumpFunMonitor } from './pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { logger } from '../utils/logger';

export class EnhancedDiscoveryService {
  private discoveryManager: DiscoveryManager;
  private tokenProcessor: EnhancedTokenProcessor;
  private deduplicationService: DeduplicationService;
  private isRunning: boolean = false;

  constructor() {
    this.discoveryManager = new DiscoveryManager();
    this.tokenProcessor = new EnhancedTokenProcessor();
    this.deduplicationService = new DeduplicationService();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Enhanced Discovery Service with API Intelligence');

    // Initialize discovery manager
    await this.discoveryManager.initialize();

    // Set up enhanced event handlers
    this.setupEnhancedEventHandlers();

    // Register monitors
    this.discoveryManager.registerMonitor(new PumpFunMonitor());
    this.discoveryManager.registerMonitor(new RaydiumMonitor());

    logger.info('Enhanced Discovery Service initialized with tiered analysis');
  }

  private setupEnhancedEventHandlers(): void {
    // Handle discovered tokens (existing logic)
    this.discoveryManager.on('tokenDiscovered', async (token) => {
      // Check for duplicates
      if (this.deduplicationService.isDuplicate(token.address, token.platform)) {
        logger.debug(`Duplicate token filtered: ${token.address}`);
        return;
      }

      // Enhanced priority calculation with more factors
      const priority = this.calculateEnhancedPriority(token);

      // Add to enhanced processing queue
      await this.tokenProcessor.addToken(token, priority);
    });

    // NEW: Handle high-value tokens identified by analysis
    this.tokenProcessor.on('highValueToken', (data) => {
      logger.info(`🚀 HIGH VALUE TOKEN IDENTIFIED: ${data.token.symbol} (${data.token.address})`);
      logger.info(`   Reason: ${data.reason}`);
      logger.info(`   Composite Score: ${(data.analysis.compositeScore * 100).toFixed(1)}%`);
      logger.info(`   Security Score: ${(data.analysis.securityScore * 100).toFixed(1)}%`);
      logger.info(`   Investment Tier: ${data.analysis.investmentTier}`);
      
      // Emit for external systems (future integrations)
      this.emit('highValueTokenFound', data);
    });

    // NEW: Handle risk alerts
    this.tokenProcessor.on('riskAlert', (data) => {
      logger.warn(`⚠️ RISK ALERT: ${data.token.symbol} (${data.token.address})`);
      logger.warn(`   Risk Level: ${data.riskLevel}`);
      logger.warn(`   Warnings: ${data.warnings.join(', ')}`);
      
      // Emit for monitoring systems
      this.emit('riskAlertDetected', data);
    });

    // NEW: Handle cost optimization alerts
    this.tokenProcessor.on('costOptimizationActive', (data) => {
      logger.info(`💰 Cost optimization active - Daily spend: $${data.dailySpend.toFixed(2)}, Remaining budget: $${data.budgetRemaining.toFixed(2)}`);
    });

    // Enhanced token ready event (backward compatibility)
    this.tokenProcessor.on('tokenReady', (token) => {
      logger.debug(`Token analysis completed: ${token.symbol} (${token.address})`);
      // Module 1C and other systems can still listen to this event
    });

    // NEW: Comprehensive token analyzed event
    this.tokenProcessor.on('tokenAnalyzed', (data) => {
      // This is where future ML systems will hook in
      logger.debug(`Token fully analyzed: ${data.token.symbol} - ${data.analysis.analysisLevel} analysis completed`);
    });

    // Handle failed tokens (existing logic)
    this.tokenProcessor.on('tokenFailed', (token, error) => {
      logger.error(`Token processing failed: ${token.address}`, error);
    });
  }

  private calculateEnhancedPriority(token: any): number {
    let priority = 50; // Base priority

    // Platform priorities (existing logic)
    if (token.platform === 'pumpfun') priority += 20;
    if (token.platform === 'raydium') priority += 15;

    // Age priority (newer = higher) - enhanced
    const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
    if (ageMinutes < 5) priority += 30;
    else if (ageMinutes < 15) priority += 20;
    else if (ageMinutes < 60) priority += 10;

    // Market cap priority (enhanced ranges)
    if (token.metadata?.marketCap) {
      const cap = token.metadata.marketCap;
      // Hidden gems range (30k-100k) gets highest priority
      if (cap >= 30000 && cap <= 100000) priority += 25;
      // New burst range (350k-1.5M) gets high priority
      else if (cap >= 350000 && cap <= 1500000) priority += 20;
      // Very new tokens under 30k get medium priority
      else if (cap < 30000 && ageMinutes < 30) priority += 15;
      // Established tokens get lower priority
      else if (cap > 1500000) priority += 5;
    }

    // Initial score priority (if available)
    if (token.metadata?.initialScore) {
      const score = token.metadata.initialScore;
      if (score > 0.8) priority += 25;
      else if (score > 0.6) priority += 15;
      else if (score > 0.4) priority += 10;
    }

    // Strategy-based priority
    if (token.metadata?.strategy) {
      if (token.metadata.strategy === 'HIDDEN_GEM') priority += 30;
      else if (token.metadata.strategy === 'NEW_BURST') priority += 25;
    }

    // Creator reputation (if available)
    if (token.metadata?.creator && this.isKnownGoodCreator(token.metadata.creator)) {
      priority += 20;
    }

    // Volume indicators (if available from initial discovery)
    if (token.metadata?.volume24h) {
      if (token.metadata.volume24h > 50000) priority += 15;
      else if (token.metadata.volume24h > 10000) priority += 10;
    }

    return Math.min(100, Math.max(0, priority));
  }

  private isKnownGoodCreator(creatorAddress: string): boolean {
    // In future, this would check against a database of successful creators
    // For now, return false
    return false;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Enhanced Discovery Service is already running');
      return;
    }

    logger.info('Starting Enhanced Discovery Service with API Intelligence');
    this.isRunning = true;

    // Start all monitors
    await this.discoveryManager.startAll();

    // Log cost optimization info
    logger.info('🔧 Cost Optimization Features:');
    logger.info('   - Tiered analysis: Premium/Standard/Basic/Minimal');
    logger.info('   - Daily budget limits: $20/day total');
    logger.info('   - Expected 60-70% cost reduction vs full premium analysis');
    logger.info('   - Smart API selection based on token potential');

    logger.info('Enhanced Discovery Service started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Enhanced Discovery Service is not running');
      return;
    }

    logger.info('Stopping Enhanced Discovery Service');
    this.isRunning = false;

    // Stop all monitors
    await this.discoveryManager.stopAll();

    // Clear processing queue
    await this.tokenProcessor.clear();

    // Stop deduplication service
    this.deduplicationService.stop();

    logger.info('Enhanced Discovery Service stopped');
  }

  // Enhanced statistics with API cost information
  getStats() {
    const processingStats = this.tokenProcessor.getStats();
    const deduplicationStats = this.deduplicationService.getStats();
    
    return {
      isRunning: this.isRunning,
      discovery: this.discoveryManager.getStats(),
      processing: processingStats,
      deduplication: deduplicationStats,
      
      // New API intelligence stats
      analysis: {
        dailyApiSpend: processingStats.dailyApiSpend,
        budgetRemaining: processingStats.budgetRemaining,
        costOptimizationActive: processingStats.costOptimizationActive,
        analysisBreakdown: processingStats.analysisBreakdown,
        avgCostPerToken: processingStats.avgCostPerToken,
        successRate: processingStats.successRate,
        premiumAnalysisRate: processingStats.premiumAnalysisRate
      }
    };
  }

  // New methods for monitoring and management
  async getHighValueTokens(limit: number = 20): Promise<any[]> {
    return await this.tokenProcessor.getHighValueTokens(limit);
  }

  async getCostSummary(): Promise<any> {
    return await this.tokenProcessor.getCostSummary();
  }

  async getSystemHealth(): Promise<any> {
    const stats = this.getStats();
    
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      discoveryRate: stats.discovery.totalDiscovered,
      analysisRate: stats.processing.processed,
      errorRate: stats.processing.failed / Math.max(1, stats.processing.processed + stats.processing.failed),
      costEfficiency: stats.analysis.costOptimizationActive ? 'optimized' : 'normal',
      budgetStatus: stats.analysis.budgetRemaining > 5 ? 'healthy' : 'low',
      recommendations: this.generateHealthRecommendations(stats)
    };
  }

  private generateHealthRecommendations(stats: any): string[] {
    const recommendations: string[] = [];
    
    if (stats.analysis.budgetRemaining < 5) {
      recommendations.push('Daily API budget is running low - consider reducing analysis frequency');
    }
    
    if (stats.processing.successRate < 0.95) {
      recommendations.push('Token analysis success rate is below 95% - check API connectivity');
    }
    
    if (stats.analysis.premiumAnalysisRate > 0.3) {
      recommendations.push('High premium analysis rate - consider adjusting initial scoring criteria');
    }
    
    if (stats.processing.queueSize > 100) {
      recommendations.push('Processing queue is large - consider increasing concurrency');
    }
    
    return recommendations;
  }

  // Expose for external event handling
  emit(event: string, data: any): void {
    // This would be handled by EventEmitter if we extended it
    // For now, just log important events
    if (event === 'highValueTokenFound') {
      logger.info(`Event emitted: ${event}`, { symbol: data.token.symbol, tier: data.analysis.investmentTier });
    }
  }
}

// Export singleton instance (replace the old discoveryService)
export const discoveryService = new EnhancedDiscoveryService();