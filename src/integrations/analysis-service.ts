// src/analysis/analysis-service.ts
// Updated version to integrate with the API Manager

import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { db } from '../database/postgres';
import { writeTokenMetrics } from '../database/questdb';
import { logger } from '../utils/logger';
import { config } from '../config';
import { apiManager } from '../integrations/api-manager';
import { AggregatedTokenData } from '../integrations/types';

export interface TokenAnalysis {
  token_address: string;
  symbol: string;
  name: string;
  analysis_data: {
    metadata: any;
    market: any;
    security: any;
    holders: any;
    liquidity: any;
    social: any;
  };
  scores: {
    safety: number;
    potential: number;
    composite: number;
  };
  classification: 'HIGH' | 'MODERATE' | 'LOW' | 'AVOID';
  analyzed_at: Date;
}

export class AnalysisService extends EventEmitter {
  private queue: PQueue;
  private isRunning: boolean = false;
  private stats = {
    totalAnalyzed: 0,
    successfulAnalyses: 0,
    failedAnalyses: 0,
    averageAnalysisTime: 0,
  };

  constructor() {
    super();
    this.queue = new PQueue({
      concurrency: 5, // Lower concurrency to respect API limits
      timeout: 60000, // 60 second timeout per analysis
      interval: 1000, // 1 second interval
      intervalCap: 3, // Max 3 analyses per second
    });

    this.queue.on('active', () => {
      logger.debug(`Analysis queue active. Size: ${this.queue.size}, Pending: ${this.queue.pending}`);
    });
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Analysis Service');
    
    // Load pending analyses
    await this.loadPendingAnalyses();
    
    logger.info('Analysis Service initialized');
  }

  private async loadPendingAnalyses(): Promise<void> {
    try {
      const pendingTokens = await db('tokens')
        .where('analysis_status', 'PENDING')
        .orderBy('discovered_at', 'asc')
        .limit(100);
      
      for (const token of pendingTokens) {
        await this.analyzeToken(token);
      }
      
      logger.info(`Loaded ${pendingTokens.length} pending tokens for analysis`);
    } catch (error) {
      logger.error('Failed to load pending analyses:', error);
    }
  }

  async analyzeToken(token: any): Promise<void> {
    await this.queue.add(async () => {
      const startTime = Date.now();
      
      try {
        logger.info(`Starting analysis for ${token.symbol || 'UNKNOWN'} (${token.address})`);
        
        // Update status to ANALYZING
        await db('tokens')
          .where('address', token.address)
          .update({ analysis_status: 'ANALYZING' });
        
        // Fetch comprehensive data from APIs
        const tokenData = await apiManager.getComprehensiveTokenData(token.address);
        
        if (!tokenData) {
          logger.warn(`No API data available for ${token.address}, using basic analysis`);
          // Use basic analysis without API data
            scores = { safety: 0.5, potential: 0.5, composite: 0.5 };
            classification = 'MODERATE';
            analysisData = null;
         } else {
          // Normal flow with API data
            scores = this.calculateScores(tokenData);
            classification = this.classifyToken(scores);
            analysisData = tokenData;
          }
        // Update token metadata if we got better data
        if (tokenData.metadata.symbol !== 'UNKNOWN' && tokenData.metadata.name !== 'Unknown Token') {
          await db('tokens')
            .where('address', token.address)
            .update({
              symbol: tokenData.metadata.symbol,
              name: tokenData.metadata.name,
            });
        }
        
        // Calculate scores
        const scores = this.calculateScores(tokenData);
        
        // Determine classification
        const classification = this.classifyToken(scores);
        
        // Store analysis results
        const analysis: TokenAnalysis = {
          token_address: token.address,
          symbol: tokenData.metadata.symbol,
          name: tokenData.metadata.name,
          analysis_data: {
            metadata: tokenData.metadata,
            market: tokenData.marketData,
            security: tokenData.securityData,
            holders: tokenData.holderData,
            liquidity: tokenData.liquidityData,
            social: tokenData.socialData,
          },
          scores,
          classification,
          analyzed_at: new Date(),
        };
        
        await this.storeAnalysis(analysis);
        
        // Update token status
        await db('tokens')
          .where('address', token.address)
          .update({
            analysis_status: 'COMPLETED',
            market_cap: tokenData.marketData.marketCap,
            price: tokenData.marketData.price.usd,
            volume_24h: tokenData.marketData.volume24h,
            liquidity: tokenData.marketData.liquidity,
            safety_score: scores.safety,
            potential_score: scores.potential,
            composite_score: scores.composite,
            investment_classification: classification,
            updated_at: new Date(),
          });
        
        // Write metrics to QuestDB
        await writeTokenMetrics({
          address: token.address,
          price: tokenData.marketData.price.usd,
          market_cap: tokenData.marketData.marketCap,
          volume_24h: tokenData.marketData.volume24h,
          holders: tokenData.holderData.totalHolders,
          safety_score: scores.safety,
        });
        
        // Emit success event
        this.emit('analysisComplete', analysis);
        
        // Update stats
        this.stats.successfulAnalyses++;
        const duration = Date.now() - startTime;
        this.updateAverageTime(duration);
        
        logger.info(`Analysis complete for ${tokenData.metadata.symbol} (${token.address})`, {
          duration: `${duration}ms`,
          classification,
          scores,
        });
        
      } catch (error) {
        logger.error(`Analysis failed for ${token.address}:`, error);
        
        // Update status to FAILED
        await db('tokens')
          .where('address', token.address)
          .update({ 
            analysis_status: 'FAILED',
            updated_at: new Date(),
          });
        
        this.stats.failedAnalyses++;
        this.emit('analysisFailed', token, error);
      } finally {
        this.stats.totalAnalyzed++;
      }
    });
  }

  private calculateScores(data: AggregatedTokenData): {
    safety: number;
    potential: number;
    composite: number;
  } {
    // Safety Score (0-1, higher is safer)
    let safety = 0.5; // Base score
    
    // Security factors
    if (data.securityData.verified) safety += 0.1;
    if (data.securityData.liquidityLocked) safety += 0.1;
    if (data.securityData.lpBurned) safety += 0.1;
    if (data.securityData.mintAuthorityRevoked) safety += 0.1;
    if (data.securityData.freezeAuthorityRevoked) safety += 0.1;
    
    // Deduct for risks
    safety -= (data.securityData.rugPullRisk / 100) * 0.3;
    if (data.securityData.buyTax > 10) safety -= 0.1;
    if (data.securityData.sellTax > 10) safety -= 0.1;
    
    // Holder distribution
    if (data.holderData.top10Percentage > 50) safety -= 0.2;
    else if (data.holderData.top10Percentage > 30) safety -= 0.1;
    
    safety = Math.max(0, Math.min(1, safety));
    
    // Potential Score (0-1, higher is better)
    let potential = 0.3; // Base score
    
    // Market factors
    if (data.marketData.volume24h > 100000) potential += 0.2;
    else if (data.marketData.volume24h > 10000) potential += 0.1;
    
    if (data.marketData.liquidity > 50000) potential += 0.2;
    else if (data.marketData.liquidity > 10000) potential += 0.1;
    
    // Price performance
    if (data.marketData.price.change24h) {
      if (data.marketData.price.change24h > 50) potential += 0.2;
      else if (data.marketData.price.change24h > 10) potential += 0.1;
      else if (data.marketData.price.change24h < -50) potential -= 0.2;
    }
    
    // Social presence
    if (data.socialData.hasWebsite) potential += 0.05;
    if (data.socialData.hasTwitter) potential += 0.05;
    if (data.socialData.hasTelegram) potential += 0.05;
    
    // Holder growth potential
    if (data.holderData.totalHolders < 100) potential += 0.1;
    else if (data.holderData.totalHolders < 500) potential += 0.05;
    
    potential = Math.max(0, Math.min(1, potential));
    
    // Composite Score (weighted average)
    const composite = (safety * 0.6) + (potential * 0.4);
    
    return {
      safety: parseFloat(safety.toFixed(4)),
      potential: parseFloat(potential.toFixed(4)),
      composite: parseFloat(composite.toFixed(4)),
    };
  }

  private classifyToken(scores: { safety: number; potential: number; composite: number }): 
    'HIGH' | 'MODERATE' | 'LOW' | 'AVOID' {
    
    if (scores.safety < 0.3 || scores.composite < 0.2) {
      return 'AVOID';
    } else if (scores.composite >= 0.7 && scores.safety >= 0.6) {
      return 'HIGH';
    } else if (scores.composite >= 0.4) {
      return 'MODERATE';
    } else {
      return 'LOW';
    }
  }

  private async storeAnalysis(analysis: TokenAnalysis): Promise<void> {
    try {
      await db('token_analysis_history').insert({
        token_address: analysis.token_address,
        analyzed_at: analysis.analyzed_at,
        holders_data: JSON.stringify(analysis.analysis_data.holders),
        security_data: JSON.stringify(analysis.analysis_data.security),
        liquidity_data: JSON.stringify(analysis.analysis_data.liquidity),
        trading_data: JSON.stringify(analysis.analysis_data.market),
        social_data: JSON.stringify(analysis.analysis_data.social),
        safety_score: analysis.scores.safety,
        potential_score: analysis.scores.potential,
        composite_score: analysis.scores.composite,
        ml_classification: analysis.classification,
        ml_confidence: 0.8, // Placeholder for ML confidence
      });
    } catch (error) {
      logger.error('Failed to store analysis:', error);
    }
  }

  private updateAverageTime(duration: number): void {
    const totalTime = this.stats.averageAnalysisTime * (this.stats.successfulAnalyses - 1);
    this.stats.averageAnalysisTime = (totalTime + duration) / this.stats.successfulAnalyses;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Analysis Service is already running');
      return;
    }

    logger.info('Starting Analysis Service');
    this.isRunning = true;
    
    // Start periodic analysis of new tokens
    this.startPeriodicAnalysis();
  }

  private startPeriodicAnalysis(): void {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const pendingTokens = await db('tokens')
          .where('analysis_status', 'PENDING')
          .orderBy('discovered_at', 'asc')
          .limit(10);
        
        for (const token of pendingTokens) {
          await this.analyzeToken(token);
        }
      } catch (error) {
        logger.error('Error in periodic analysis:', error);
      }
    }, 30000); // Check every 30 seconds
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Analysis Service is not running');
      return;
    }

    logger.info('Stopping Analysis Service');
    this.isRunning = false;
    
    // Clear the queue
    this.queue.clear();
    
    // Wait for current analyses to complete
    await this.queue.onIdle();
  }

  getStats() {
    const apiStatus = apiManager.getAPIStatus();
    
    return {
      ...this.stats,
      queueSize: this.queue.size,
      pending: this.queue.pending,
      isRunning: this.isRunning,
      apiStatus,
    };
  }
}

// Export singleton instance
export const analysisService = new AnalysisService();