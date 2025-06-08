// src/utils/pumpfun-bonding-curve.ts

import { PUMP_FUN_CONSTANTS } from '../constants/pumpfun-constants';
import { logger } from './logger2';

export interface BondingCurveState {
  marketCapUSD: number;
  priceUSD: number;
  priceSOL: number;
  tokensSold: number;
  tokensRemaining: number;
  progressPercent: number;
  usdRaised: number;
  solRaised: number;
  isGraduated: boolean;
  distanceToGraduation: {
    usd: number;
    tokens: number;
  };
}

/**
 * Pump.fun EXPONENTIAL Bonding Curve Calculator
 * Formula: price_per_10M = 0.6015 * e^(0.00003606 * marketCap)
 */
export class PumpFunBondingCurve {
  private solPriceUSD: number = 180;
  
  public setSolPrice(priceUSD: number): void {
    if (priceUSD <= 0) {
      logger.warn(`Invalid SOL current_price: ${priceUSD}`);
      return;
    }
    this.solPriceUSD = priceUSD;
    logger.debug(`Updated SOL price to $${priceUSD}`);
  }

  public getSolPrice(): number {
    return this.solPriceUSD;
  }

  /**
   * Calculate price at a given market cap using exponential formula
   */
  public calculatePriceAtMarketCap(marketCapUSD: number): number {
    const A = PUMP_FUN_CONSTANTS.CURVE_COEFFICIENT_A;
    const B = PUMP_FUN_CONSTANTS.CURVE_COEFFICIENT_B;
    
    // Price per 10M tokens
    const pricePer10M = A * Math.exp(B * marketCapUSD);
    
    // Price per token in USD
    const pricePerTokenUSD = pricePer10M / 10_000_000;
    
    // Convert to SOL
    return pricePerTokenUSD / this.solPriceUSD;
  }

  /**
   * Calculate tokens sold based on progress (simplified)
   */
  public calculateTokensSold(marketCapUSD: number): number {
    const progress = (marketCapUSD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD) / 
                    (PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD);
    
    return Math.floor(Math.max(0, Math.min(1, progress)) * PUMP_FUN_CONSTANTS.BONDING_CURVE_SUPPLY);
  }

  /**
   * Calculate USD raised based on progress
   */
  public calculateUsdRaised(marketCapUSD: number): number {
    const progress = (marketCapUSD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD) / 
                    (PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD);
    
    return Math.max(0, Math.min(1, progress)) * PUMP_FUN_CONSTANTS.TOTAL_RAISED_USD;
  }

  /**
   * Get state from tokens sold (reverse calculation)
   */
  public getState(tokensSold: number): BondingCurveState {
    // Calculate progress
    const progress = tokensSold / PUMP_FUN_CONSTANTS.BONDING_CURVE_SUPPLY;
    
    // Calculate market cap from progress
    const marketCapUSD = PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD + 
      (progress * (PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD));
    
    return this.getStateAtMarketCap(marketCapUSD);
  }

  /**
   * Get state at a specific market cap
   */
  public getStateAtMarketCap(marketCapUSD: number): BondingCurveState {
    const priceSOL = this.calculatePriceAtMarketCap(marketCapUSD);
    const priceUSD = priceSOL * this.solPriceUSD;
    const tokensSold = this.calculateTokensSold(marketCapUSD);
    const usdRaised = this.calculateUsdRaised(marketCapUSD);
    const solRaised = usdRaised / this.solPriceUSD;
    
    const progress = (marketCapUSD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD) / 
                    (PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD);
    
    return {
      marketCapUSD,
      priceUSD,
      priceSOL,
      tokensSold,
      tokensRemaining: PUMP_FUN_CONSTANTS.BONDING_CURVE_SUPPLY - tokensSold,
      progressPercent: Math.max(0, Math.min(100, progress * 100)),
      usdRaised,
      solRaised,
      isGraduated: marketCapUSD >= PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD,
      distanceToGraduation: {
        usd: Math.max(0, PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - marketCapUSD),
        tokens: Math.max(0, PUMP_FUN_CONSTANTS.BONDING_CURVE_SUPPLY - tokensSold)
      }
    };
  }

  /**
   * Estimate time to graduation
   */
  public estimateTimeToGraduation(currentMarketCap: number, recentGrowthRate: number): number | null {
    if (recentGrowthRate <= 0) return null;
    
    const remaining = PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - currentMarketCap;
    if (remaining <= 0) return 0;
    
    return remaining / recentGrowthRate; // In minutes
  }

  /**
   * Get key milestones
   */
  public getMilestones() {
    return {
      start: this.getStateAtMarketCap(PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD),
      quarter: this.getStateAtMarketCap(20000),
      half: this.getStateAtMarketCap(36500),
      threeQuarter: this.getStateAtMarketCap(52750),
      graduation: this.getStateAtMarketCap(PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD),
    };
  }
  
  // Compatibility methods for existing code
  public calculatePrice(tokensSold: number): number {
    const state = this.getState(tokensSold);
    return state.priceSOL;
  }
  
  public calculatePurchaseCost(currentTokensSold: number, tokensToBuy: number): any {
    // Simplified - would need integration for exact cost
    const startState = this.getState(currentTokensSold);
    const endState = this.getState(currentTokensSold + tokensToBuy);
    const avgPrice = (startState.priceSOL + endState.priceSOL) / 2;
    const totalCost = avgPrice * tokensToBuy;
    
    return {
      tokenAmount: tokensToBuy,
      avgPrice,
      totalCostSOL: totalCost,
      feeSOL: totalCost * PUMP_FUN_CONSTANTS.TRADING_FEE_PERCENT,
      totalWithFeeSOL: totalCost * (1 + PUMP_FUN_CONSTANTS.TRADING_FEE_PERCENT),
      totalWithFeeUSD: totalCost * (1 + PUMP_FUN_CONSTANTS.TRADING_FEE_PERCENT) * this.solPriceUSD,
      priceImpact: ((endState.priceSOL - startState.priceSOL) / startState.priceSOL) * 100,
    };
  }
}

// Export singleton instance
export const bondingCurveCalculator = new PumpFunBondingCurve();


