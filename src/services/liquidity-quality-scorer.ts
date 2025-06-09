// src/services/liquidity-quality-scorer.ts

import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import { PUMP_FUN_CONSTANTS } from '../constants/pumpfun-constants';

export interface LiquidityQualityScore {
  tokenAddress: string;
  overallScore: number;        // 0-100 score
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  
  // Individual scoring components
  scores: {
    amount: number;           // 0-25 points for liquidity amount
    stability: number;        // 0-25 points for price stability
    growth: number;           // 0-25 points for healthy growth
    depth: number;            // 0-25 points for market depth
  };
  
  // Quality indicators
  indicators: {
    sufficientLiquidity: boolean;      // >= $7,500 (your current threshold)
    stablePrice: boolean;              // Low volatility
    healthyGrowth: boolean;            // Positive but not excessive growth
    goodMarketDepth: boolean;          // Good real vs virtual reserves ratio
    nearGraduation: boolean;           // Close to Raydium migration
  };
  
  // Trading suitability
  tradingSuitability: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'RISKY';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  
  // Actionable insights
  insights: string[];
  warnings: string[];
}

export class LiquidityQualityScorer {
  
  /**
   * STEP 1: Main scoring function - analyzes all quality aspects
   */
  async scoreLiquidityQuality(tokenAddress: string): Promise<LiquidityQualityScore> {
    try {
      // Get current token data
      const tokenData = await this.getTokenData(tokenAddress);
      if (!tokenData) {
        return this.createFailedScore(tokenAddress, 'Token not found');
      }

      // Get price history for stability analysis
      const priceHistory = await this.getPriceHistory(tokenAddress);
      
      // Calculate individual scores
      const amountScore = this.scoreAmount(tokenData.liquidity_usd);
      const stabilityScore = await this.scoreStability(priceHistory);
      const growthScore = await this.scoreGrowth(tokenAddress);
      const depthScore = this.scoreDepth(tokenData);
      
      // Calculate overall score
      const overallScore = amountScore + stabilityScore + growthScore + depthScore;
      const grade = this.calculateGrade(overallScore);
      
      // Determine quality indicators
      const indicators = this.calculateIndicators(tokenData, priceHistory, overallScore);
      
      // Assess trading suitability and risk
      const tradingSuitability = this.assessTradingSuitability(overallScore, indicators);
      const riskLevel = this.assessRiskLevel(tokenData, indicators);
      
      // Generate insights and warnings
      const insights = this.generateInsights(tokenData, indicators, overallScore);
      const warnings = this.generateWarnings(tokenData, indicators);

      return {
        tokenAddress,
        overallScore,
        grade,
        scores: {
          amount: amountScore,
          stability: stabilityScore,
          growth: growthScore,
          depth: depthScore
        },
        indicators,
        tradingSuitability,
        riskLevel,
        insights,
        warnings
      };

    } catch (error) {
      logger.error(`Error scoring liquidity quality for ${tokenAddress}:`, error);
      return this.createFailedScore(tokenAddress, 'Scoring error');
    }
  }

  /**
   * STEP 2: Score liquidity amount (0-25 points)
   */
  private scoreAmount(liquidityUsd: number): number {
    if (liquidityUsd >= 50000) return 25;      // Excellent
    if (liquidityUsd >= 25000) return 22;      // Very good
    if (liquidityUsd >= 15000) return 18;      // Good
    if (liquidityUsd >= 7500) return 15;       // Your minimum threshold
    if (liquidityUsd >= 5000) return 10;       // Below threshold but reasonable
    if (liquidityUsd >= 2500) return 5;        // Low
    return 0;                                   // Very low
  }

  /**
   * STEP 3: Score price stability (0-25 points)
   */
  private async scoreStability(priceHistory: any[]): Promise<number> {
    if (priceHistory.length < 10) return 10; // Not enough data for stable score

    // Calculate price volatility over last hour
    const prices = priceHistory.slice(0, 20).map(p => Number(p.price_usd));
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    
    // Calculate standard deviation
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance) / avgPrice; // Coefficient of variation

    // Score based on volatility (lower is better)
    if (volatility < 0.02) return 25;        // Very stable (< 2% volatility)
    if (volatility < 0.05) return 20;        // Stable (< 5% volatility)
    if (volatility < 0.10) return 15;        // Moderate (< 10% volatility)
    if (volatility < 0.20) return 10;        // Volatile (< 20% volatility)
    if (volatility < 0.50) return 5;         // Very volatile (< 50% volatility)
    return 0;                                 // Extremely volatile
  }

  /**
   * STEP 4: Score growth healthiness (0-25 points)
   */
  private async scoreGrowth(tokenAddress: string): Promise<number> {
    try {
      // Get liquidity growth over different periods
      const growthData = await db.raw(`
        WITH periods AS (
          SELECT 
            token_address,
            MAX(CASE WHEN time > NOW() - INTERVAL '1 hour' THEN liquidity_usd END) as current_liquidity,
            MAX(CASE WHEN time > NOW() - INTERVAL '2 hours' AND time <= NOW() - INTERVAL '1 hour' THEN liquidity_usd END) as liquidity_1h_ago,
            MAX(CASE WHEN time > NOW() - INTERVAL '6 hours' AND time <= NOW() - INTERVAL '4 hours' THEN liquidity_usd END) as liquidity_4h_ago
          FROM timeseries.token_prices 
          WHERE token_address = ?
          GROUP BY token_address
        )
        SELECT 
          COALESCE(current_liquidity, 0) as current_liquidity,
          COALESCE(liquidity_1h_ago, 0) as liquidity_1h_ago,
          COALESCE(liquidity_4h_ago, 0) as liquidity_4h_ago
        FROM periods
      `, [tokenAddress]);

      if (growthData.rows.length === 0) return 10; // No data available

      const { current_liquidity, liquidity_1h_ago, liquidity_4h_ago } = growthData.rows[0];
      
      // Calculate growth rates
      const growth1h = liquidity_1h_ago > 0 ? 
        ((current_liquidity - liquidity_1h_ago) / liquidity_1h_ago) * 100 : 0;
      const growth4h = liquidity_4h_ago > 0 ? 
        ((current_liquidity - liquidity_4h_ago) / liquidity_4h_ago) * 100 : 0;

      // Score based on healthy growth patterns
      if (growth1h > 0 && growth1h < 20 && growth4h > 0 && growth4h < 50) {
        return 25; // Healthy steady growth
      }
      if (growth1h > 0 && growth1h < 50 && growth4h > 0) {
        return 20; // Good growth
      }
      if (growth1h > -10 && growth4h > 0) {
        return 15; // Stable/slight growth
      }
      if (growth1h > -25 && growth4h > -20) {
        return 10; // Minor decline
      }
      if (growth1h < -25 || growth4h < -50) {
        return 0; // Significant decline
      }

      return 12; // Default moderate score

    } catch (error) {
      logger.error('Error calculating growth score:', error);
      return 10;
    }
  }

  /**
   * STEP 5: Score market depth (0-25 points) 
   */
  private scoreDepth(tokenData: any): number {
    const realSol = Number(tokenData.real_sol_reserves) / 1e9;
    const virtualSol = Number(tokenData.virtual_sol_reserves) / 1e9;
    
    if (virtualSol === 0) return 0;
    
    // Calculate depth ratio (real vs virtual reserves)
    const depthRatio = realSol / virtualSol;
    const graduationProgress = (realSol / PUMP_FUN_CONSTANTS.EXPECTED_SOL_AT_GRADUATION) * 100;

    // Score based on depth and graduation progress
    if (depthRatio > 0.8 && graduationProgress > 80) return 25; // Excellent depth, near graduation
    if (depthRatio > 0.6 && graduationProgress > 60) return 22; // Very good depth
    if (depthRatio > 0.4 && graduationProgress > 40) return 18; // Good depth
    if (depthRatio > 0.2 && graduationProgress > 20) return 15; // Moderate depth
    if (depthRatio > 0.1) return 10;                           // Low depth
    return 5; // Very low depth
  }

  /**
   * STEP 6: Calculate quality indicators
   */
  private calculateIndicators(tokenData: any, priceHistory: any[], overallScore: number) {
    const liquidityUsd = Number(tokenData.liquidity_usd || 0);
    const realSol = Number(tokenData.real_sol_reserves) / 1e9;
    const graduationProgress = (realSol / PUMP_FUN_CONSTANTS.EXPECTED_SOL_AT_GRADUATION) * 100;
    
    // Calculate price volatility for stability check
    let stablePrice = true;
    if (priceHistory.length >= 10) {
      const recentPrices = priceHistory.slice(0, 10).map(p => Number(p.price_usd));
      const maxPrice = Math.max(...recentPrices);
      const minPrice = Math.min(...recentPrices);
      const volatility = ((maxPrice - minPrice) / minPrice) * 100;
      stablePrice = volatility < 25; // Less than 25% volatility in recent data
    }

    return {
      sufficientLiquidity: liquidityUsd >= 7500,
      stablePrice,
      healthyGrowth: overallScore >= 60,
      goodMarketDepth: realSol > 10, // At least 10 SOL real reserves
      nearGraduation: graduationProgress > 70
    };
  }

  /**
   * STEP 7: Assess trading suitability
   */
  private assessTradingSuitability(score: number, indicators: any): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'RISKY' {
    if (score >= 85 && indicators.sufficientLiquidity && indicators.stablePrice) return 'EXCELLENT';
    if (score >= 70 && indicators.sufficientLiquidity) return 'GOOD';
    if (score >= 55 && indicators.sufficientLiquidity) return 'FAIR';
    if (score >= 40 || indicators.sufficientLiquidity) return 'POOR';
    return 'RISKY';
  }

  /**
   * STEP 8: Assess risk level
   */
  private assessRiskLevel(tokenData: any, indicators: any): 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' {
    const riskFactors = [
      !indicators.sufficientLiquidity,
      !indicators.stablePrice,
      !indicators.healthyGrowth,
      !indicators.goodMarketDepth,
      Number(tokenData.market_cap || 0) < 5000  // Very low market cap
    ];

    const riskCount = riskFactors.filter(Boolean).length;

    if (riskCount === 0) return 'LOW';
    if (riskCount <= 1) return 'MEDIUM';
    if (riskCount <= 3) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * STEP 9: Generate actionable insights
   */
  private generateInsights(tokenData: any, indicators: any, score: number): string[] {
    const insights: string[] = [];
    const liquidityUsd = Number(tokenData.liquidity_usd || 0);
    const realSol = Number(tokenData.real_sol_reserves) / 1e9;

    if (indicators.nearGraduation) {
      insights.push(`🎓 Near graduation (${((realSol / 73) * 100).toFixed(1)}% complete) - potential Raydium migration soon`);
    }

    if (indicators.sufficientLiquidity && indicators.stablePrice) {
      insights.push(`💎 High quality liquidity - stable price with sufficient depth ($${liquidityUsd.toLocaleString()})`);
    }

    if (score >= 80) {
      insights.push(`⭐ Excellent liquidity quality - suitable for larger position sizes`);
    }

    if (liquidityUsd >= 25000) {
      insights.push(`🚀 High liquidity token - can handle larger trades with minimal slippage`);
    }

    return insights;
  }

  /**
   * STEP 10: Generate warnings
   */
  private generateWarnings(tokenData: any, indicators: any): string[] {
    const warnings: string[] = [];

    if (!indicators.sufficientLiquidity) {
      warnings.push(`⚠️ Low liquidity - below $7,500 threshold (currently $${Number(tokenData.liquidity_usd || 0).toLocaleString()})`);
    }

    if (!indicators.stablePrice) {
      warnings.push(`📊 High price volatility - expect significant slippage on trades`);
    }

    if (!indicators.goodMarketDepth) {
      warnings.push(`📉 Poor market depth - limited real SOL reserves in bonding curve`);
    }

    return warnings;
  }

  /**
   * Helper methods
   */
  private async getTokenData(tokenAddress: string) {
    const result = await db('tokens').where('address', tokenAddress).first();
    return result;
  }

  private async getPriceHistory(tokenAddress: string) {
    const result = await db('timeseries.token_prices')
      .where('token_address', tokenAddress)
      .where('time', '>', db.raw("NOW() - INTERVAL '2 hours'"))
      .orderBy('time', 'desc')
      .limit(50);
    return result;
  }

  private calculateGrade(score: number): 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F' {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C+';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
  }

  private createFailedScore(tokenAddress: string, reason: string): LiquidityQualityScore {
    return {
      tokenAddress,
      overallScore: 0,
      grade: 'F',
      scores: { amount: 0, stability: 0, growth: 0, depth: 0 },
      indicators: {
        sufficientLiquidity: false,
        stablePrice: false,
        healthyGrowth: false,
        goodMarketDepth: false,
        nearGraduation: false
      },
      tradingSuitability: 'RISKY',
      riskLevel: 'EXTREME',
      insights: [],
      warnings: [`❌ ${reason}`]
    };
  }
}

// Export singleton instance
export const LIQUIDITY_QUALITY_SCORER = new LiquidityQualityScorer();