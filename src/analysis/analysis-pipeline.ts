// src/analysis/analysis-pipeline.ts
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { AddressValidator } from '../utils/address-validator';
import { BasicAnalyzer } from './basic-analyzer';
import { config } from '../config';

export class AnalysisPipeline extends EventEmitter {
  private queue: PQueue;
  private analyzer: BasicAnalyzer;
  private stats = {
    analyzed: 0,
    failed: 0,
    skipped: 0,
    invalidAddresses: 0,
  };

  constructor() {
    super();
    
    this.queue = new PQueue({
      concurrency: config.discovery.maxConcurrentProcessing,
      timeout: 60000, // 60 second timeout
    });
    
    this.analyzer = new BasicAnalyzer();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Analysis Pipeline');
    
    // Set up queue event handlers
    this.queue.on('active', () => {
      logger.debug(`Analysis queue active. Size: ${this.queue.size}, Pending: ${this.queue.pending}`);
    });
  }

  async analyzeToken(tokenAddress: string, priority: number = 50): Promise<void> {
    // Validate address first
    if (!AddressValidator.isValidAddress(tokenAddress)) {
      logger.warn(`Skipping analysis for invalid address: ${tokenAddress}`);
      this.stats.invalidAddresses++;
      return;
    }

    // Check if already analyzed
    const existing = await db('tokens')
      .where('address', tokenAddress)
      .where('analysis_status', 'COMPLETED')
      .first();

    if (existing) {
      logger.debug(`Token already analyzed: ${tokenAddress}`);
      this.stats.skipped++;
      return;
    }

    // Add to queue
    await this.queue.add(
      async () => this.performAnalysis(tokenAddress),
      { priority }
    );
  }

  private async performAnalysis(tokenAddress: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info(`Analyzing token: ${tokenAddress}`);
      
      // Update status to analyzing
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          analysis_status: 'ANALYZING',
          updated_at: new Date(),
        });

      // Perform basic analysis
      const analysis = await this.analyzer.analyze(tokenAddress);
      
      // Calculate scores
      const scores = this.calculateScores(analysis);
      
      // Update database
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          market_cap: analysis.marketCap,
          price: analysis.price,
          volume_24h: analysis.volume24h,
          liquidity: analysis.liquidity,
          safety_score: scores.safety,
          potential_score: scores.potential,
          composite_score: scores.composite,
          analysis_status: 'COMPLETED',
          investment_classification: this.classifyInvestment(scores.composite),
          updated_at: new Date(),
        });

      // Store analysis history
      await db('token_analysis_history').insert({
        token_address: tokenAddress,
        analyzed_at: new Date(),
        holders_data: JSON.stringify(analysis.holders || {}),
        security_data: JSON.stringify(analysis.security || {}),
        liquidity_data: JSON.stringify({ liquidity: analysis.liquidity }),
        trading_data: JSON.stringify({ volume24h: analysis.volume24h }),
        safety_score: scores.safety,
        potential_score: scores.potential,
        composite_score: scores.composite,
      });

      this.stats.analyzed++;
      const duration = Date.now() - startTime;
      
      logger.info(`Analysis completed for ${tokenAddress} in ${duration}ms. Score: ${scores.composite.toFixed(3)}`);
      
      // Emit event
      this.emit('analysisCompleted', {
        address: tokenAddress,
        scores,
        classification: this.classifyInvestment(scores.composite),
      });
      
    } catch (error) {
      this.stats.failed++;
      logger.error(`Analysis failed for ${tokenAddress}:`, error);
      
      // Update status to failed
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          analysis_status: 'FAILED',
          updated_at: new Date(),
        });
      
      this.emit('analysisFailed', { address: tokenAddress, error });
    }
  }

  private calculateScores(analysis: any): { safety: number; potential: number; composite: number } {
    // Basic scoring algorithm (will be enhanced in Module 2D)
    let safety = 0.5;
    let potential = 0.5;

    // Safety factors
    if (analysis.holders?.count > 100) safety += 0.1;
    if (analysis.holders?.count > 1000) safety += 0.1;
    if (analysis.liquidity > 10000) safety += 0.1;
    if (analysis.liquidity > 100000) safety += 0.1;
    if (analysis.volume24h > 50000) safety += 0.1;

    // Potential factors
    if (analysis.marketCap < 100000) potential += 0.2;
    if (analysis.marketCap < 50000) potential += 0.1;
    if (analysis.volume24h > analysis.marketCap * 0.1) potential += 0.1;
    if (analysis.holders?.count < 500) potential += 0.1;

    // Normalize scores
    safety = Math.min(1, Math.max(0, safety));
    potential = Math.min(1, Math.max(0, potential));
    
    // Calculate composite
    const composite = (safety * 0.6) + (potential * 0.4);

    return {
      safety: Number(safety.toFixed(4)),
      potential: Number(potential.toFixed(4)),
      composite: Number(composite.toFixed(4)),
    };
  }

  private classifyInvestment(score: number): string {
    if (score >= 0.8) return 'STRONG_BUY';
    if (score >= 0.65) return 'BUY';
    if (score >= 0.5) return 'HOLD';
    if (score >= 0.35) return 'WATCH';
    return 'AVOID';
  }

  async analyzePendingTokens(): Promise<void> {
    logger.info('Analyzing pending tokens...');
    
    const pendingTokens = await db('tokens')
      .where('analysis_status', 'PENDING')
      .orderBy('discovered_at', 'desc')
      .limit(100);

    logger.info(`Found ${pendingTokens.length} pending tokens`);
    
    for (const token of pendingTokens) {
      await this.analyzeToken(token.address);
    }
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.size,
      pending: this.queue.pending,
    };
  }
}