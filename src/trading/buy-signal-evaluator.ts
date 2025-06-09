// src/trading/buy-signal-evaluator.ts - ENHANCED WITH LIQUIDITY QUALITY SCORING

import { TokenCategory, categoryConfig } from '../config/category-config';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import { EventEmitter } from 'events';

// Import new liquidity services
import { LIQUIDITY_QUALITY_SCORER, LiquidityQualityScore } from '../services/liquidity-quality-scorer';
import { LIQUIDITY_GROWTH_TRACKER, LiquidityGrowthMetrics } from '../services/liquidity-growth-tracker';

export interface BuyCriteria {
  marketCap: boolean;
  liquidity: boolean;
  holders: boolean;
  concentration: boolean;
  solsniffer: boolean;
  // NEW: Liquidity quality criteria
  liquidityQuality: boolean;
  liquidityGrowth: boolean;
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
  
  // NEW: Enhanced liquidity metrics
  liquidityQualityScore?: LiquidityQualityScore;
  liquidityGrowthMetrics?: LiquidityGrowthMetrics;
  
  // Criteria results
  criteria: BuyCriteria;
  
  // Overall result
  passed: boolean;
  failureReasons: string[];
  confidence: number;
  
  // Enhanced position sizing
  recommendedPosition?: number;
  positionLimitFactors?: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export class BuySignalEvaluator extends EventEmitter {
  private readonly criteria = categoryConfig.buySignalCriteria;
  
  /**
   * ENHANCED: Evaluate a token for buy signal with liquidity quality
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
          // NEW: Initialize liquidity quality criteria
          liquidityQuality: false,
          liquidityGrowth: false,
        },
        passed: false,
        failureReasons: [],
        confidence: 0,
        riskLevel: 'HIGH' // Default to high risk
      };
      
      // Evaluate traditional criteria
      this.evaluateMarketCap(evaluation);
      this.evaluateLiquidity(evaluation);
      this.evaluateHolders(evaluation);
      this.evaluateConcentration(evaluation);
      await this.evaluateSolSniffer(evaluation, token);
      
      // NEW: Evaluate liquidity quality and growth
      await this.evaluateLiquidityQuality(evaluation);
      await this.evaluateLiquidityGrowth(evaluation);
      
      // Calculate overall result with enhanced criteria
      evaluation.passed = Object.values(evaluation.criteria).every(v => v === true);
      evaluation.confidence = this.calculateEnhancedConfidence(evaluation);
      evaluation.riskLevel = this.assessRiskLevel(evaluation);
      
      // Enhanced position sizing
      evaluation.recommendedPosition = this.calculatePositionSize(evaluation);
      evaluation.positionLimitFactors = this.getPositionLimitFactors(evaluation);
      
      // Enhanced logging with liquidity context
      logger.info(`Buy evaluation for ${token.symbol}: ${evaluation.passed ? 'PASSED' : 'FAILED'}`, {
        criteria: evaluation.criteria,
        liquidityGrade: evaluation.liquidityQualityScore?.grade,
        liquidityMomentum: evaluation.liquidityGrowthMetrics?.momentum,
        riskLevel: evaluation.riskLevel,
        confidence: evaluation.confidence.toFixed(2)
      });
      
      if (!evaluation.passed) {
        logger.info(`Failure reasons: ${evaluation.failureReasons.join(', ')}`);
      }
      
      // Record evaluation
      await this.recordEvaluation(evaluation, Date.now() - startTime);
      
      // Emit event with enhanced data
      this.emit('evaluationComplete', evaluation);
      
      return evaluation;
      
    } catch (error) {
      logger.error(`Buy evaluation failed for ${tokenAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * NEW: Evaluate liquidity quality
   */
  private async evaluateLiquidityQuality(evaluation: BuyEvaluation): Promise<void> {
    try {
      const qualityScore = await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(evaluation.tokenAddress);
      evaluation.liquidityQualityScore = qualityScore;
      
      // Pass if liquidity quality is good or excellent AND not risky
      evaluation.criteria.liquidityQuality = 
        qualityScore.overallScore >= 70 && 
        ['EXCELLENT', 'GOOD', 'FAIR'].includes(qualityScore.tradingSuitability) &&
        qualityScore.riskLevel !== 'EXTREME';
      
      if (!evaluation.criteria.liquidityQuality) {
        evaluation.failureReasons.push(
          `Liquidity quality: ${qualityScore.grade} (${qualityScore.overallScore}/100) - ${qualityScore.tradingSuitability}`
        );
        
        // Add specific warnings if available
        if (qualityScore.warnings.length > 0) {
          evaluation.failureReasons.push(`Quality warnings: ${qualityScore.warnings.join(', ')}`);
        }
      } else {
        logger.info(`[BUY_SIGNAL] Liquidity quality PASSED: ${qualityScore.grade} (${qualityScore.overallScore}/100)`);
      }
      
    } catch (error) {
      logger.error('Error evaluating liquidity quality:', error);
      evaluation.criteria.liquidityQuality = false;
      evaluation.failureReasons.push('Liquidity quality evaluation failed');
    }
  }
  
  /**
   * NEW: Evaluate liquidity growth patterns
   */
  private async evaluateLiquidityGrowth(evaluation: BuyEvaluation): Promise<void> {
    try {
      const growthMetrics = await LIQUIDITY_GROWTH_TRACKER.getGrowthMetrics(evaluation.tokenAddress);
      evaluation.liquidityGrowthMetrics = growthMetrics;
      
      // Pass if growth is healthy (positive or stable momentum, not declining)
      evaluation.criteria.liquidityGrowth = 
        ['HIGH', 'MEDIUM', 'LOW'].includes(growthMetrics.momentum) && // Not declining
        growthMetrics.growthRate1h >= -2; // Not rapidly losing liquidity
      
      if (!evaluation.criteria.liquidityGrowth) {
        evaluation.failureReasons.push(
          `Liquidity growth: ${growthMetrics.momentum} momentum (${growthMetrics.growthRate1h.toFixed(2)} SOL/hour)`
        );
      } else {
        logger.info(`[BUY_SIGNAL] Liquidity growth PASSED: ${growthMetrics.momentum} momentum`);
      }
      
    } catch (error) {
      logger.error('Error evaluating liquidity growth:', error);
      evaluation.criteria.liquidityGrowth = false;
      evaluation.failureReasons.push('Liquidity growth evaluation failed');
    }
  }
  
  /**
   * Get token data including security data
   */
  private async getTokenData(tokenAddress: string): Promise<any> {
    const token = await db('tokens')
      .where('address', tokenAddress)
      .first();
      
    // Parse security_data if it exists
    if (token && token.security_data) {
      try {
        token.parsedSecurityData = typeof token.security_data === 'string' 
          ? JSON.parse(token.security_data)
          : token.security_data;
      } catch (e) {
        logger.warn(`Failed to parse security_data for ${tokenAddress}`);
      }
    }
    
    return token;
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
      evaluation.criteria.solsniffer = false;
      evaluation.failureReasons.push('No SolSniffer data available');
      return;
    }
    
    const hoursSinceCheck = (Date.now() - new Date(token.solsniffer_checked_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCheck > 1) {
      evaluation.criteria.solsniffer = false;
      evaluation.failureReasons.push('SolSniffer data is stale (>1 hour old)');
      return;
    }
    
    // Get the score (0-100 where 100 is safest)
    const score = token.solsniffer_score;
    
    if (score === null || score === undefined) {
      evaluation.criteria.solsniffer = false;
      evaluation.failureReasons.push('SolSniffer score is null');
      return;
    }
    
    // Update the evaluation with the actual score
    evaluation.solsnifferScore = score;
    
    const { min, blacklist } = this.criteria.solsniffer;
    
    // Check blacklist (score of exactly 90 is blacklisted)
    if (blacklist.includes(score)) {
      evaluation.criteria.solsniffer = false;
      evaluation.failureReasons.push(
        `SolSniffer score ${score} is blacklisted`
      );
      logger.info(`[BUY_SIGNAL] SolSniffer score ${score} is BLACKLISTED`);
      return;
    }
    
    // Check minimum (score must be > 60)
    evaluation.criteria.solsniffer = score > min;
    
    if (!evaluation.criteria.solsniffer) {
      evaluation.failureReasons.push(
        `SolSniffer score ${score} below minimum ${min}`
      );
    } else {
      logger.info(`[BUY_SIGNAL] SolSniffer score ${score} PASSED (>${min} and ≠90)`);
    }
    
    // Log additional security data if available
    if (token.parsedSecurityData) {
      logger.info(`[BUY_SIGNAL] Additional security data:`, {
        riskLevel: token.parsedSecurityData.riskLevel,
        warnings: token.parsedSecurityData.warnings?.length || 0,
        risks: {
          high: token.parsedSecurityData.highRiskCount || 0,
          medium: token.parsedSecurityData.mediumRiskCount || 0,
          low: token.parsedSecurityData.lowRiskCount || 0
        }
      });
    }
  }
  
  /**
   * ENHANCED: Calculate confidence score with liquidity factors
   */
  private calculateEnhancedConfidence(evaluation: BuyEvaluation): number {
    if (!evaluation.passed) return 0;
    
    let confidence = 0.3; // Lower base confidence - more stringent
    
    // Traditional factors (reduced weight)
    if (evaluation.marketCap >= 35000 && evaluation.marketCap <= 70000) {
      confidence += 0.1;
    }
    
    if (evaluation.liquidity > 15000) {
      confidence += 0.1;
    }
    
    if (evaluation.holders > 150) {
      confidence += 0.05;
    }
    
    if (evaluation.top10Percent < 15) {
      confidence += 0.05;
    }
    
    if (evaluation.solsnifferScore > 80 && evaluation.solsnifferScore !== 90) {
      confidence += 0.1;
    }
    
    // NEW: Liquidity quality factors (higher weight)
    if (evaluation.liquidityQualityScore) {
      const qualityScore = evaluation.liquidityQualityScore;
      
      // Excellent liquidity quality gives major boost
      if (qualityScore.tradingSuitability === 'EXCELLENT') {
        confidence += 0.15;
      } else if (qualityScore.tradingSuitability === 'GOOD') {
        confidence += 0.1;
      } else if (qualityScore.tradingSuitability === 'FAIR') {
        confidence += 0.05;
      }
      
      // Stable price is important
      if (qualityScore.indicators.stablePrice) {
        confidence += 0.05;
      }
      
      // Near graduation is valuable
      if (qualityScore.indicators.nearGraduation) {
        confidence += 0.1;
      }
    }
    
    // NEW: Liquidity growth factors
    if (evaluation.liquidityGrowthMetrics) {
      const growth = evaluation.liquidityGrowthMetrics;
      
      if (growth.momentum === 'HIGH' && growth.accelerating) {
        confidence += 0.15; // High momentum + acceleration
      } else if (growth.momentum === 'HIGH') {
        confidence += 0.1;
      } else if (growth.momentum === 'MEDIUM') {
        confidence += 0.05;
      }
      
      // Positive recent growth
      if (growth.growthRate1h > 1) {
        confidence += 0.05;
      }
    }
    
    return Math.min(1, confidence);
  }
  
  /**
   * NEW: Assess overall risk level
   */
  private assessRiskLevel(evaluation: BuyEvaluation): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
    const riskFactors = [
      !evaluation.criteria.marketCap,
      !evaluation.criteria.liquidity,
      !evaluation.criteria.holders,
      !evaluation.criteria.concentration,
      !evaluation.criteria.solsniffer,
      !evaluation.criteria.liquidityQuality,
      !evaluation.criteria.liquidityGrowth,
      evaluation.liquidityQualityScore?.riskLevel === 'EXTREME',
      evaluation.liquidityGrowthMetrics?.momentum === 'DECLINING'
    ];
    
    const riskCount = riskFactors.filter(Boolean).length;
    
    if (riskCount === 0 && evaluation.confidence > 0.8) return 'LOW';
    if (riskCount <= 1 && evaluation.confidence > 0.6) return 'MEDIUM';
    if (riskCount <= 3) return 'HIGH';
    return 'EXTREME';
  }
  
  /**
   * NEW: Calculate position size based on liquidity quality
   */
  private calculatePositionSize(evaluation: BuyEvaluation): number {
    if (!evaluation.passed) return 0;
    
    let baseSize = 1.0; // Base position size (could be SOL amount or percentage)
    
    // Adjust based on liquidity quality
    if (evaluation.liquidityQualityScore) {
      const quality = evaluation.liquidityQualityScore;
      
      switch (quality.tradingSuitability) {
        case 'EXCELLENT':
          baseSize *= 1.5; // Can trade larger size
          break;
        case 'GOOD':
          baseSize *= 1.2;
          break;
        case 'FAIR':
          baseSize *= 1.0;
          break;
        case 'POOR':
          baseSize *= 0.5;
          break;
        case 'RISKY':
          baseSize *= 0.25;
          break;
      }
    }
    
    // Adjust based on confidence
    baseSize *= evaluation.confidence;
    
    // Adjust based on risk level
    switch (evaluation.riskLevel) {
      case 'LOW':
        baseSize *= 1.2;
        break;
      case 'MEDIUM':
        baseSize *= 1.0;
        break;
      case 'HIGH':
        baseSize *= 0.6;
        break;
      case 'EXTREME':
        baseSize *= 0.3;
        break;
    }
    
    return Math.max(0.1, Math.min(baseSize, 3.0)); // Between 0.1 and 3.0
  }
  
  /**
   * NEW: Get factors limiting position size
   */
  private getPositionLimitFactors(evaluation: BuyEvaluation): string[] {
    const factors: string[] = [];
    
    if (evaluation.liquidityQualityScore?.tradingSuitability === 'POOR') {
      factors.push('Poor liquidity quality limits position size');
    }
    
    if (evaluation.liquidityGrowthMetrics?.momentum === 'DECLINING') {
      factors.push('Declining liquidity momentum limits position size');
    }
    
    if (evaluation.riskLevel === 'HIGH' || evaluation.riskLevel === 'EXTREME') {
      factors.push(`${evaluation.riskLevel} risk level limits position size`);
    }
    
    if (evaluation.confidence < 0.6) {
      factors.push('Low confidence limits position size');
    }
    
    return factors;
  }
  
  /**
   * ENHANCED: Record evaluation in database with liquidity data
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
      
      // NEW: Liquidity quality fields
      liquidity_quality_pass: evaluation.criteria.liquidityQuality,
      liquidity_growth_pass: evaluation.criteria.liquidityGrowth,
      liquidity_quality_score: evaluation.liquidityQualityScore?.overallScore,
      liquidity_quality_grade: evaluation.liquidityQualityScore?.grade,
      liquidity_momentum: evaluation.liquidityGrowthMetrics?.momentum,
      
      passed: evaluation.passed,
      failure_reasons: JSON.stringify(evaluation.failureReasons),
      confidence: evaluation.confidence,
      risk_level: evaluation.riskLevel,
      position_size: evaluation.recommendedPosition,
      position_limit_factors: JSON.stringify(evaluation.positionLimitFactors),
      
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
   * ENHANCED: Get statistics with liquidity metrics
   */
  async getStats(): Promise<any> {
    const [
      totalEvaluations,
      passedEvaluations,
      recentEvaluations,
      liquidityQualityPassed,
      highConfidenceEvaluations
    ] = await Promise.all([
      db('buy_evaluations').count('* as count').first(),
      db('buy_evaluations').where('passed', true).count('* as count').first(),
      db('buy_evaluations')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count').first(),
      db('buy_evaluations').where('liquidity_quality_pass', true).count('* as count').first(),
      db('buy_evaluations').where('confidence', '>', 0.8).count('* as count').first()
    ]);
    
    const passRate = Number(totalEvaluations?.count) > 0
      ? (Number(passedEvaluations?.count) / Number(totalEvaluations?.count)) * 100
      : 0;
    
    const liquidityQualityRate = Number(totalEvaluations?.count) > 0
      ? (Number(liquidityQualityPassed?.count) / Number(totalEvaluations?.count)) * 100
      : 0;
    
    return {
      totalEvaluations: Number(totalEvaluations?.count) || 0,
      passedEvaluations: Number(passedEvaluations?.count) || 0,
      passRate: passRate.toFixed(2) + '%',
      liquidityQualityRate: liquidityQualityRate.toFixed(2) + '%',
      highConfidenceEvaluations: Number(highConfidenceEvaluations?.count) || 0,
      last24Hours: Number(recentEvaluations?.count) || 0,
    };
  }
}

// Export singleton instance
export const buySignalEvaluator = new BuySignalEvaluator();