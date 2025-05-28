// src/discovery/enhanced-token-processor.ts
import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TokenDiscovery } from './base-monitor';
import { config } from '../config';
import { TieredTokenAnalyzer, TokenAnalysisResult } from '../analysis/tiered-analyzer';
import { db } from '../database/postgres';
import { writeTokenMetrics } from '../database/questdb';

export interface ProcessingTask {
  id: string;
  token: TokenDiscovery;
  priority: number;
  createdAt: Date;
  attempts: number;
}

export class EnhancedTokenProcessor extends EventEmitter {
  private queue: PQueue;
  private analyzer: TieredTokenAnalyzer;
  private processing: Map<string, ProcessingTask> = new Map();
  private stats = {
    processed: 0,
    failed: 0,
    skipped: 0,
    currentQueueSize: 0,
    analysisLevelCounts: {
      PREMIUM: 0,
      STANDARD: 0,
      BASIC: 0,
      MINIMAL: 0
    },
    totalCostToday: 0
  };

  constructor() {
    super();
    
    this.queue = new PQueue({
      concurrency: config.discovery.maxConcurrentProcessing,
      timeout: 60000, // Increased timeout for API calls
    });

    this.analyzer = new TieredTokenAnalyzer();

    this.queue.on('active', () => {
      this.stats.currentQueueSize = this.queue.size;
      logger.debug(`Processing queue active. Size: ${this.queue.size}, Pending: ${this.queue.pending}`);
    });

    this.queue.on('idle', () => {
      logger.debug('Processing queue idle');
    });
  }

  async addToken(token: TokenDiscovery, priority: number = 50): Promise<void> {
    if (this.queue.size >= config.discovery.discoveryQueueSize) {
      logger.warn('Processing queue full, dropping token', {
        address: token.address,
        queueSize: this.queue.size,
      });
      this.stats.skipped++;
      return;
    }

    const task: ProcessingTask = {
      id: `${token.address}-${Date.now()}`,
      token,
      priority,
      createdAt: new Date(),
      attempts: 0,
    };

    await this.queue.add(
      async () => this.processTokenWithAnalysis(task),
      { priority }
    );
  }

  private async processTokenWithAnalysis(task: ProcessingTask): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Processing token with analysis: ${task.token.symbol} (${task.token.address})`);
      this.processing.set(task.token.address, task);

      // Step 1: Basic validation (existing logic)
      await this.validateToken(task.token);

      // Step 2: Enhanced analysis using tiered analyzer
      const analysisResult = await this.analyzer.analyzeToken(task.token);

      // Step 3: Store comprehensive results
      await this.storeAnalysisResults(task.token, analysisResult);

      // Step 4: Update statistics
      this.updateProcessingStats(analysisResult);

      // Step 5: Emit appropriate events based on results
      await this.emitResultEvents(task.token, analysisResult);
      
      this.stats.processed++;
      
      const duration = Date.now() - startTime;
      logger.info(`Token processed with ${analysisResult.analysisLevel} analysis: ${task.token.symbol} - Score: ${analysisResult.compositeScore.toFixed(3)}, Tier: ${analysisResult.investmentTier} (${duration}ms, $${analysisResult.costIncurred.toFixed(4)})`);
      
    } catch (error) {
      this.stats.failed++;
      logger.error(`Failed to process token ${task.token.address}:`, error);
      
      // Retry logic
      if (task.attempts < 3) {
        task.attempts++;
        logger.info(`Retrying token ${task.token.address} (attempt ${task.attempts})`);
        await this.addToken(task.token, task.priority - 10);
      } else {
        this.emit('tokenFailed', task.token, error);
      }
    } finally {
      this.processing.delete(task.token.address);
    }
  }

  private async storeAnalysisResults(token: TokenDiscovery, analysis: TokenAnalysisResult): Promise<void> {
    try {
      // Update the main tokens table with analysis results
      await db('tokens')
        .where('address', token.address)
        .update({
          // Analysis scores
          safety_score: analysis.securityScore,
          potential_score: analysis.potentialScore,
          composite_score: analysis.compositeScore,
          
          // Market data (if available)
          market_cap: analysis.marketData?.marketCap || null,
          price: analysis.marketData?.price || null,
          volume_24h: analysis.marketData?.volume24h || null,
          liquidity: analysis.pairData?.[0]?.liquidity || null,
          
          // Status and classification
          analysis_status: 'COMPLETED',
          investment_classification: analysis.investmentTier,
          
          // Store comprehensive raw data
          raw_data: JSON.stringify({
            ...token.metadata,
            analysisLevel: analysis.analysisLevel,
            riskLevel: analysis.riskLevel,
            confidence: analysis.confidence,
            warnings: analysis.warnings,
            processingTime: analysis.processingTime,
            costIncurred: analysis.costIncurred,
            
            // API data (only store what we have)
            securityData: analysis.securityData,
            marketData: analysis.marketData,
            pairData: analysis.pairData,
            holderData: analysis.holderData ? analysis.holderData.slice(0, 20) : undefined, // Store top 20 holders only
            enhancedData: analysis.enhancedData
          }),
          
          updated_at: new Date()
        });

      // Store detailed analysis history
      await db('token_analysis_history').insert({
        token_address: token.address,
        analyzed_at: analysis.timestamp,
        
        // Store detailed analysis data in JSONB columns
        security_data: analysis.securityData ? JSON.stringify(analysis.securityData) : null,
        liquidity_data: analysis.pairData ? JSON.stringify(analysis.pairData) : null,
        trading_data: analysis.enhancedData ? JSON.stringify(analysis.enhancedData) : null,
        holders_data: analysis.holderData ? JSON.stringify(analysis.holderData.slice(0, 50)) : null,
        
        // Scores at time of analysis
        safety_score: analysis.securityScore,
        potential_score: analysis.potentialScore,
        composite_score: analysis.compositeScore,
        
        // Classification results
        ml_classification: analysis.investmentTier,
        ml_confidence: analysis.confidence
      });

      // Write time-series data to QuestDB for monitoring
      await writeTokenMetrics({
        address: token.address,
        price: analysis.marketData?.price || 0,
        market_cap: analysis.marketData?.marketCap || 0,
        volume_24h: analysis.marketData?.volume24h || 0,
        holders: analysis.marketData?.holders || 0,
        safety_score: analysis.securityScore,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error('Failed to store analysis results:', error);
      throw error;
    }
  }

  private updateProcessingStats(analysis: TokenAnalysisResult): void {
    this.stats.analysisLevelCounts[analysis.analysisLevel]++;
    this.stats.totalCostToday += analysis.costIncurred;
  }

  private async emitResultEvents(token: TokenDiscovery, analysis: TokenAnalysisResult): Promise<void> {
    // Emit different events based on analysis results
    
    // High-quality tokens ready for immediate attention
    if (analysis.investmentTier === 'HIDDEN_GEM' || analysis.investmentTier === 'NEW_BURST') {
      this.emit('highValueToken', {
        token,
        analysis,
        priority: 'HIGH',
        reason: `${analysis.investmentTier} with ${(analysis.compositeScore * 100).toFixed(1)}% score`
      });
    }

    // Tokens with concerning security issues
    if (analysis.riskLevel === 'CRITICAL' || analysis.riskLevel === 'HIGH') {
      this.emit('riskAlert', {
        token,
        analysis,
        riskLevel: analysis.riskLevel,
        warnings: analysis.warnings
      });
    }

    // Cost optimization alerts
    const costStats = this.analyzer.getAnalysisStats();
    if (costStats.costOptimizationActive) {
      this.emit('costOptimizationActive', {
        dailySpend: costStats.dailySpend,
        budgetRemaining: costStats.budgetRemaining
      });
    }

    // Standard processing complete event
    this.emit('tokenAnalyzed', {
      token,
      analysis
    });

    // Legacy compatibility - emit the original tokenReady event
    this.emit('tokenReady', token);
  }

  private async validateToken(token: TokenDiscovery): Promise<void> {
    // Enhanced validation with more checks
    if (!token.address || token.address.length < 32) {
      throw new Error('Invalid token address');
    }

    if (!token.symbol || token.symbol.length === 0) {
      throw new Error('Missing token symbol');
    }

    if (!token.platform) {
      throw new Error('Missing platform');
    }

    // Check if token was created too long ago (potential stale data)
    const ageHours = (Date.now() - token.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > 168) { // More than a week old
      logger.warn(`Processing old token: ${token.symbol} (${ageHours.toFixed(1)} hours old)`);
    }

    // Validate token address format (Solana addresses are base58 encoded)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token.address)) {
      throw new Error('Invalid Solana address format');
    }
  }

  // Enhanced statistics
  getStats() {
    const costStats = this.analyzer.getAnalysisStats();
    
    return {
      // Existing stats
      ...this.stats,
      queueSize: this.queue.size,
      pending: this.queue.pending,
      isRunning: !this.queue.isPaused,
      
      // New analysis stats
      analysisBreakdown: this.stats.analysisLevelCounts,
      avgCostPerToken: this.stats.processed > 0 ? this.stats.totalCostToday / this.stats.processed : 0,
      
      // Cost optimization stats
      dailyApiSpend: costStats.dailySpend,
      budgetRemaining: costStats.budgetRemaining,
      costOptimizationActive: costStats.costOptimizationActive,
      
      // Performance calculations
      successRate: this.stats.processed / Math.max(1, this.stats.processed + this.stats.failed),
      
      // Efficiency metrics
      premiumAnalysisRate: this.stats.analysisLevelCounts.PREMIUM / Math.max(1, this.stats.processed),
      avgProcessingCost: this.stats.totalCostToday / Math.max(1, this.stats.processed)
    };
  }

  // New methods for monitoring and control
  async getHighValueTokens(limit: number = 20): Promise<any[]> {
    return await db('tokens')
      .select('address', 'symbol', 'name', 'composite_score', 'investment_classification', 'discovered_at')
      .where('analysis_status', 'COMPLETED')
      .whereIn('investment_classification', ['HIDDEN_GEM', 'NEW_BURST'])
      .orderBy('composite_score', 'desc')
      .limit(limit);
  }

  async getCostSummary(): Promise<any> {
    const today = new Date().toISOString().split('T')[0];
    
    return {
      dailySpend: this.stats.totalCostToday,
      tokenAnalyzed: this.stats.processed,
      avgCostPerToken: this.stats.totalCostToday / Math.max(1, this.stats.processed),
      analysisBreakdown: this.stats.analysisLevelCounts,
      projectedMonthlyCost: this.stats.totalCostToday * 30,
      costOptimizationSavings: this.calculateCostOptimizationSavings()
    };
  }

  private calculateCostOptimizationSavings(): number {
    // Calculate how much we would have spent with full premium analysis
    const totalTokens = this.stats.processed;
    const fullPremiumCost = totalTokens * 0.025; // $0.025 per premium analysis
    const actualCost = this.stats.totalCostToday;
    
    return Math.max(0, fullPremiumCost - actualCost);
  }

  // Legacy methods for compatibility
  async pause(): Promise<void> {
    this.queue.pause();
    logger.info('Enhanced token processor paused');
  }

  async resume(): Promise<void> {
    this.queue.start();
    logger.info('Enhanced token processor resumed');
  }

  async clear(): Promise<void> {
    await this.queue.clear();
    logger.info('Enhanced token processor queue cleared');
  }
}