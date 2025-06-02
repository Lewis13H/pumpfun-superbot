import { TokenCategory, categoryConfig } from '../config/category-config';
import { db } from '../database/postgres';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface BuyCriteria {
  marketCap: boolean;
  liquidity: boolean;
  holders: boolean;
  concentration: boolean;
  solsniffer: boolean;
}

export interface BuyEvaluation {
  tokenAddress: string;
  timestamp: Date;
  
  // Market data at evaluation
  marketCap: number;
  liquidity: number;
  holders: number;
  top10Percent: number;
  solsnifferScore: number;
  
  // Criteria results
  criteria: BuyCriteria;
  
  // Overall result
  passed: boolean;
  failureReasons: string[];
  confidence: number;
  
  // Position sizing
  recommendedPosition?: number;
  positionLimitFactors?: string[];
}

export class BuySignalEvaluator extends EventEmitter {
  private readonly criteria = categoryConfig.buySignalCriteria;
  
  /**
   * Evaluate a token for buy signal
   */
  async evaluateToken(tokenAddress: string): Promise<BuyEvaluation> {
    const startTime = Date.now();
    
    try {
      // Get token data
      const token = await this.getTokenData(tokenAddress);
      if (!token) {
        throw new Error('Token not found');
      }
      
      // Verify token is in AIM category
      if (token.category !== 'AIM') {
        throw new Error(`Token is in ${token.category} category, not AIM`);
      }
      
      // Initialize evaluation
      const evaluation: BuyEvaluation = {
        tokenAddress,
        timestamp: new Date(),
        marketCap: Number(token.market_cap) || 0,
        liquidity: Number(token.liquidity) || 0,
        holders: token.holders || 0,
        top10Percent: Number(token.top_10_percent) || 0,
        solsnifferScore: token.solsniffer_score || 0,
        criteria: {
          marketCap: false,
          liquidity: false,
          holders: false,
          concentration: false,
          solsniffer: false,
        },
        passed: false,
        failureReasons: [],
        confidence: 0,
      };
      
      // Evaluate each criterion
      this.evaluateMarketCap(evaluation);
      this.evaluateLiquidity(evaluation);
      this.evaluateHolders(evaluation);
      this.evaluateConcentration(evaluation);
      await this.evaluateSolSniffer(evaluation, token);
      
      // Calculate overall result
      evaluation.passed = Object.values(evaluation.criteria).every(v => v === true);
      evaluation.confidence = this.calculateConfidence(evaluation);
      
      // Log evaluation
      logger.info(`Buy evaluation for ${token.symbol}: ${evaluation.passed ? 'PASSED' : 'FAILED'}`);
      if (!evaluation.passed) {
        logger.info(`Failure reasons: ${evaluation.failureReasons.join(', ')}`);
      }
      
      // Record evaluation
      await this.recordEvaluation(evaluation, Date.now() - startTime);
      
      // Emit event
      this.emit('evaluationComplete', evaluation);
      
      return evaluation;
      
    } catch (error) {
      logger.error(`Buy evaluation failed for ${tokenAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Get token data
   */
  private async getTokenData(tokenAddress: string): Promise<any> {
    return await db('tokens')
      .where('address', tokenAddress)
      .first();
  }
  
  /**
   * Evaluate market cap
   */
  private evaluateMarketCap(evaluation: BuyEvaluation): void {
    const { min, max } = this.criteria.marketCap;
    
    evaluation.criteria.marketCap = 
      evaluation.marketCap >= min && 
      evaluation.marketCap <= max;
    
    if (!evaluation.criteria.marketCap) {
      if (evaluation.marketCap < min) {
        evaluation.failureReasons.push(
          `Market cap $${evaluation.marketCap} below minimum $${min}`
        );
      } else {
        evaluation.failureReasons.push(
          `Market cap $${evaluation.marketCap} above maximum $${max}`
        );
      }
    }
  }
  
  /**
   * Evaluate liquidity
   */
  private evaluateLiquidity(evaluation: BuyEvaluation): void {
    const minLiquidity = this.criteria.liquidity.min;
    
    evaluation.criteria.liquidity = evaluation.liquidity >= minLiquidity;
    
    if (!evaluation.criteria.liquidity) {
      evaluation.failureReasons.push(
        `Liquidity $${evaluation.liquidity} below minimum $${minLiquidity}`
      );
    }
  }
  
  /**
   * Evaluate holder count
   */
  private evaluateHolders(evaluation: BuyEvaluation): void {
    const minHolders = this.criteria.holders.min;
    
    evaluation.criteria.holders = evaluation.holders >= minHolders;
    
    if (!evaluation.criteria.holders) {
      evaluation.failureReasons.push(
        `Holders ${evaluation.holders} below minimum ${minHolders}`
      );
    }
  }
  
  /**
   * Evaluate concentration
   */
  private evaluateConcentration(evaluation: BuyEvaluation): void {
    const maxConcentration = this.criteria.top10Concentration.max;
    
    evaluation.criteria.concentration = evaluation.top10Percent <= maxConcentration;
    
    if (!evaluation.criteria.concentration) {
      evaluation.failureReasons.push(
        `Top 10 concentration ${evaluation.top10Percent}% above maximum ${maxConcentration}%`
      );
    }
  }
  
  /**
   * Evaluate SolSniffer score
   */
  private async evaluateSolSniffer(evaluation: BuyEvaluation, token: any): Promise<void> {
    // Check if we have recent SolSniffer data
    if (!token.solsniffer_checked_at) {
      evaluation.failureReasons.push('No SolSniffer data available');
      return;
    }
    
    const hoursSinceCheck = (Date.now() - new Date(token.solsniffer_checked_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCheck > 1) {
      evaluation.failureReasons.push('SolSniffer data is stale (>1 hour old)');
      return;
    }
    
    const { min, blacklist } = this.criteria.solsniffer;
    
    // Check blacklist
    if (blacklist.includes(evaluation.solsnifferScore)) {
      evaluation.criteria.solsniffer = false;
      evaluation.failureReasons.push(
        `SolSniffer score ${evaluation.solsnifferScore} is blacklisted`
      );
      return;
    }
    
    // Check minimum
    evaluation.criteria.solsniffer = evaluation.solsnifferScore > min;
    
    if (!evaluation.criteria.solsniffer) {
      evaluation.failureReasons.push(
        `SolSniffer score ${evaluation.solsnifferScore} below minimum ${min}`
      );
    }
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(evaluation: BuyEvaluation): number {
    if (!evaluation.passed) return 0;
    
    let confidence = 0.5; // Base confidence
    
    // Market cap in sweet spot
    if (evaluation.marketCap >= 35000 && evaluation.marketCap <= 70000) {
      confidence += 0.1;
    }
    
    // Strong liquidity
    if (evaluation.liquidity > 15000) {
      confidence += 0.1;
    }
    
    // Good holder count
    if (evaluation.holders > 150) {
      confidence += 0.1;
    }
    
    // Low concentration
    if (evaluation.top10Percent < 15) {
      confidence += 0.1;
    }
    
    // High SolSniffer score
    if (evaluation.solsnifferScore > 80) {
      confidence += 0.1;
    }
    
    return Math.min(1, confidence);
  }
  
  /**
   * Record evaluation in database
   */
  private async recordEvaluation(evaluation: BuyEvaluation, duration: number): Promise<void> {
    await db('buy_evaluations').insert({
      token_address: evaluation.tokenAddress,
      market_cap: evaluation.marketCap,
      liquidity: evaluation.liquidity,
      holders: evaluation.holders,
      top_10_percent: evaluation.top10Percent,
      solsniffer_score: evaluation.solsnifferScore,
      
      market_cap_pass: evaluation.criteria.marketCap,
      liquidity_pass: evaluation.criteria.liquidity,
      holders_pass: evaluation.criteria.holders,
      concentration_pass: evaluation.criteria.concentration,
      solsniffer_pass: evaluation.criteria.solsniffer,
      
      passed: evaluation.passed,
      failure_reasons: JSON.stringify(evaluation.failureReasons),
      position_size: evaluation.recommendedPosition,
      
      evaluation_duration_ms: duration,
      created_at: new Date(),
    });
    
    // Update token buy attempts
    await db('tokens')
      .where('address', evaluation.tokenAddress)
      .increment('buy_attempts', 1)
      .update({
        buy_failure_reasons: evaluation.passed 
          ? null 
          : JSON.stringify(evaluation.failureReasons),
      });
  }
  
  /**
   * Get tokens ready for evaluation
   */
  async getAimTokensForEvaluation(): Promise<any[]> {
    return await db('tokens')
      .where('category', 'AIM')
      .where('solsniffer_checked_at', '>', new Date(Date.now() - 60 * 60 * 1000)) // Recent data
      .whereRaw('(buy_attempts IS NULL OR buy_attempts < 3)') // Max 3 attempts
      .orderBy('market_cap', 'desc')
      .limit(20);
  }
  
  /**
   * Evaluate all ready tokens
   */
  async evaluateAllReady(): Promise<BuyEvaluation[]> {
    const tokens = await this.getAimTokensForEvaluation();
    const results: BuyEvaluation[] = [];
    
    logger.info(`Found ${tokens.length} AIM tokens ready for evaluation`);
    
    for (const token of tokens) {
      try {
        const evaluation = await this.evaluateToken(token.address);
        results.push(evaluation);
        
        // Add delay to avoid overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Failed to evaluate ${token.address}:`, error);
      }
    }
    
    return results;
  }
  
  /**
   * Get evaluation history
   */
  async getEvaluationHistory(
    limit: number = 100,
    onlyPassed: boolean = false
  ): Promise<any[]> {
    let query = db('buy_evaluations')
      .orderBy('created_at', 'desc')
      .limit(limit);
    
    if (onlyPassed) {
      query = query.where('passed', true);
    }
    
    return await query;
  }
  
  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const [
      totalEvaluations,
      passedEvaluations,
      recentEvaluations
    ] = await Promise.all([
      db('buy_evaluations').count('* as count').first(),
      db('buy_evaluations').where('passed', true).count('* as count').first(),
      db('buy_evaluations')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count').first()
    ]);
    
    const passRate = Number(totalEvaluations?.count) > 0
      ? (Number(passedEvaluations?.count) / Number(totalEvaluations?.count)) * 100
      : 0;
    
    return {
      totalEvaluations: Number(totalEvaluations?.count) || 0,
      passedEvaluations: Number(passedEvaluations?.count) || 0,
      passRate: passRate.toFixed(2) + '%',
      last24Hours: Number(recentEvaluations?.count) || 0,
    };
  }
}

// Export singleton instance
export const buySignalEvaluator = new BuySignalEvaluator();
