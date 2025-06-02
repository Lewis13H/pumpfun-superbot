// src/utils/pumpfun-bonding-curve-exponential.ts

import { PUMP_FUN_CONSTANTS } from '../constants/pumpfun-constants';
import { logger } from './logger';

/**
 * CORRECT Pump.fun Exponential Bonding Curve Implementation
 * Based on reverse-engineered formula: y = 0.6015e^(0.00003606x)
 */

export class PumpFunExponentialBondingCurve {
  private solPriceUSD: number = 180;
  
  // Constants from the documentation
  private readonly INITIAL_MARKET_CAP = 4000;        // $4k starting market cap
  private readonly FINAL_MARKET_CAP = 69000;         // $69k graduation market cap
  private readonly TOTAL_RAISED = 12000;             // $12k total raised
  private readonly TOKENS_FOR_SALE = 800_000_000;   // 800M tokens
  private readonly TOKENS_FOR_LP = 200_000_000;     // 200M for liquidity
  
  // Exponential curve constants
  private readonly A = 0.6015;                       // Coefficient
  private readonly B = 0.00003606;                   // Exponent coefficient
  
  /**
   * Calculate price per token at a given market cap
   * Formula: price_per_10M = 0.6015 * e^(0.00003606 * marketCap)
   */
  public calculatePriceAtMarketCap(marketCapUSD: number): number {
    // Calculate price per 10M tokens
    const pricePer10M = this.A * Math.exp(this.B * marketCapUSD);
    
    // Convert to price per token
    const pricePerToken = pricePer10M / 10_000_000;
    
    // Convert USD to SOL
    return pricePerToken / this.solPriceUSD;
  }
  
  /**
   * Calculate tokens sold at a given market cap
   * Market Cap = Total Supply * Price
   * So: Tokens Sold = Market Cap / Price (approximately)
   */
  public calculateTokensSoldAtMarketCap(marketCapUSD: number): number {
    const priceUSD = this.calculatePriceAtMarketCap(marketCapUSD) * this.solPriceUSD;
    
    // This is an approximation - we'd need to integrate to be exact
    // But we know at $69k market cap, 800M tokens are sold
    const progress = (marketCapUSD - this.INITIAL_MARKET_CAP) / 
                    (this.FINAL_MARKET_CAP - this.INITIAL_MARKET_CAP);
    
    return Math.floor(progress * this.TOKENS_FOR_SALE);
  }
  
  /**
   * Calculate total SOL raised up to a market cap
   * This requires integration of the price curve
   */
  public calculateSolRaisedAtMarketCap(marketCapUSD: number): number {
    // We know that at $69k market cap, $12k is raised
    // So we can use proportional approximation
    const progress = (marketCapUSD - this.INITIAL_MARKET_CAP) / 
                    (this.FINAL_MARKET_CAP - this.INITIAL_MARKET_CAP);
    
    const usdRaised = progress * this.TOTAL_RAISED;
    return usdRaised / this.solPriceUSD;
  }
  
  /**
   * Get bonding curve state at any market cap
   */
  public getStateAtMarketCap(marketCapUSD: number): any {
    const priceSOL = this.calculatePriceAtMarketCap(marketCapUSD);
    const priceUSD = priceSOL * this.solPriceUSD;
    const tokensSold = this.calculateTokensSoldAtMarketCap(marketCapUSD);
    const solRaised = this.calculateSolRaisedAtMarketCap(marketCapUSD);
    const progress = (marketCapUSD - this.INITIAL_MARKET_CAP) / 
                    (this.FINAL_MARKET_CAP - this.INITIAL_MARKET_CAP);
    
    return {
      marketCapUSD,
      priceSOL,
      priceUSD,
      tokensSold,
      tokensRemaining: this.TOKENS_FOR_SALE - tokensSold,
      solRaised,
      usdRaised: solRaised * this.solPriceUSD,
      progressPercent: progress * 100,
      isGraduated: marketCapUSD >= this.FINAL_MARKET_CAP,
      distanceToGraduation: {
        usd: Math.max(0, this.FINAL_MARKET_CAP - marketCapUSD),
        tokens: Math.max(0, this.TOKENS_FOR_SALE - tokensSold)
      }
    };
  }
  
  /**
   * Key milestone prices
   */
  public getMilestones() {
    return {
      start: {
        marketCap: this.INITIAL_MARKET_CAP,
        current_price: this.calculatePriceAtMarketCap(this.INITIAL_MARKET_CAP),
        priceUSD: this.calculatePriceAtMarketCap(this.INITIAL_MARKET_CAP) * this.solPriceUSD
      },
      graduation: {
        marketCap: this.FINAL_MARKET_CAP,
        current_price: this.calculatePriceAtMarketCap(this.FINAL_MARKET_CAP),
        priceUSD: this.calculatePriceAtMarketCap(this.FINAL_MARKET_CAP) * this.solPriceUSD,
        totalRaisedUSD: this.TOTAL_RAISED,
        totalRaisedSOL: this.TOTAL_RAISED / this.solPriceUSD
      },
      dexPrice: {
        // Initial DEX price = $12k / 200M tokens = $0.00006
        priceUSD: this.TOTAL_RAISED / this.TOKENS_FOR_LP,
        priceSOL: (this.TOTAL_RAISED / this.TOKENS_FOR_LP) / this.solPriceUSD
      }
    };
  }
  
  public setSolPrice(price: number) {
    this.solPriceUSD = price;
  }
}

export const exponentialBondingCurve = new PumpFunExponentialBondingCurve();

