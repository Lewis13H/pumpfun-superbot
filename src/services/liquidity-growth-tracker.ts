// src/services/liquidity-growth-tracker.ts

import { db } from '../database/postgres';
import { logger } from '../utils/logger2';

export interface LiquidityGrowthMetrics {
  tokenAddress: string;
  currentLiquiditySol: number;
  growthRate1h: number;       // SOL/hour over last 1 hour
  growthRate6h: number;       // SOL/hour over last 6 hours  
  growthRate24h: number;      // SOL/hour over last 24 hours
  accelerating: boolean;      // Is growth rate increasing?
  momentum: 'HIGH' | 'MEDIUM' | 'LOW' | 'DECLINING';
  peakLiquidity: number;      // Highest liquidity ever seen
  timeToPeak: number | null;  // Hours since peak
}

export class LiquidityGrowthTracker {
  private growthCache = new Map<string, LiquidityGrowthMetrics>();
  private lastUpdate = new Map<string, Date>();

  /**
   * Step 1: Calculate growth rates from TimescaleDB data
   */
  async calculateGrowthRate(tokenAddress: string): Promise<LiquidityGrowthMetrics> {
    try {
      // Get liquidity history from TimescaleDB
      const liquidityHistory = await db.raw(`
        SELECT 
          time,
          real_sol_reserves / 1e9 as liquidity_sol,
          EXTRACT(EPOCH FROM (time - LAG(time, 1) OVER (ORDER BY time))) / 3600 as hours_since_last
        FROM timeseries.token_prices 
        WHERE token_address = ?
          AND time > NOW() - INTERVAL '25 hours'
          AND real_sol_reserves IS NOT NULL
        ORDER BY time DESC
        LIMIT 100
      `, [tokenAddress]);

      if (liquidityHistory.rows.length < 2) {
        return this.createEmptyMetrics(tokenAddress);
      }

      const current = liquidityHistory.rows[0];
      const currentLiquidity = Number(current.liquidity_sol);

      // Calculate growth rates for different periods
      const growthRates = {
        '1h': this.calculatePeriodGrowthRate(liquidityHistory.rows, 1),
        '6h': this.calculatePeriodGrowthRate(liquidityHistory.rows, 6), 
        '24h': this.calculatePeriodGrowthRate(liquidityHistory.rows, 24)
      };

      // Determine momentum
      const momentum = this.calculateMomentum(growthRates);

      // Check if accelerating (1h > 6h growth rate)
      const accelerating = growthRates['1h'] > growthRates['6h'] && growthRates['1h'] > 0;

      // Find peak liquidity
      const peakLiquidity = Math.max(...liquidityHistory.rows.map((r: any) => Number(r.liquidity_sol)));
      const peakRow = liquidityHistory.rows.find((r: any) => Number(r.liquidity_sol) === peakLiquidity);
      const timeToPeak = peakRow ? 
        (Date.now() - new Date(peakRow.time).getTime()) / (1000 * 60 * 60) : null;

      const metrics: LiquidityGrowthMetrics = {
        tokenAddress,
        currentLiquiditySol: currentLiquidity,
        growthRate1h: growthRates['1h'],
        growthRate6h: growthRates['6h'],
        growthRate24h: growthRates['24h'],
        accelerating,
        momentum,
        peakLiquidity,
        timeToPeak
      };

      // Cache results
      this.growthCache.set(tokenAddress, metrics);
      this.lastUpdate.set(tokenAddress, new Date());

      return metrics;

    } catch (error) {
      logger.error(`Error calculating growth rate for ${tokenAddress}:`, error);
      return this.createEmptyMetrics(tokenAddress);
    }
  }

  /**
   * Step 2: Calculate growth rate for specific time period
   */
  private calculatePeriodGrowthRate(rows: any[], periodHours: number): number {
    // Find data points at the start and end of period
    let totalHours = 0;
    let startLiquidity = null;
    let endLiquidity = Number(rows[0].liquidity_sol);

    for (let i = 0; i < rows.length - 1; i++) {
      const hoursToAdd = Number(rows[i].hours_since_last) || 0;
      totalHours += hoursToAdd;

      if (totalHours >= periodHours) {
        startLiquidity = Number(rows[i].liquidity_sol);
        break;
      }
    }

    if (startLiquidity === null || totalHours === 0) {
      return 0;
    }

    // Calculate SOL/hour growth rate
    const liquidityChange = endLiquidity - startLiquidity;
    const growthRate = liquidityChange / totalHours;

    return Number(growthRate.toFixed(4));
  }

  /**
   * Step 3: Determine momentum based on growth rates
   */
  private calculateMomentum(rates: Record<string, number>): 'HIGH' | 'MEDIUM' | 'LOW' | 'DECLINING' {
    const { '1h': rate1h, '6h': rate6h, '24h': rate24h } = rates;

    // Declining - all negative or recent worse than past
    if (rate1h < 0 && rate6h < 0) return 'DECLINING';
    if (rate1h < rate6h && rate6h < rate24h && rate1h < 1) return 'DECLINING';

    // High momentum - strong recent growth
    if (rate1h > 5 && rate1h > rate6h) return 'HIGH';
    if (rate1h > 2 && rate6h > 1 && rate1h > rate6h * 1.5) return 'HIGH';

    // Medium momentum - consistent growth
    if (rate1h > 1 && rate6h > 0.5) return 'MEDIUM';
    if (rate1h > 0 && rate6h > 0 && rate24h > 0) return 'MEDIUM';

    // Low momentum - minimal growth
    return 'LOW';
  }

  /**
   * Step 4: Get cached metrics or calculate fresh
   */
  async getGrowthMetrics(tokenAddress: string, maxAge: number = 300000): Promise<LiquidityGrowthMetrics> {
    const lastUpdate = this.lastUpdate.get(tokenAddress);
    const cached = this.growthCache.get(tokenAddress);

    // Return cached if recent enough (default 5 minutes)
    if (cached && lastUpdate && (Date.now() - lastUpdate.getTime() < maxAge)) {
      return cached;
    }

    // Calculate fresh metrics
    return await this.calculateGrowthRate(tokenAddress);
  }

  /**
   * Step 5: Batch calculate for multiple tokens
   */
  async batchCalculateGrowthRates(tokenAddresses: string[]): Promise<Map<string, LiquidityGrowthMetrics>> {
    const results = new Map<string, LiquidityGrowthMetrics>();

    // Process in batches to avoid overwhelming database
    const batchSize = 10;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      
      const promises = batch.map(address => this.calculateGrowthRate(address));
      const batchResults = await Promise.all(promises);
      
      batch.forEach((address, index) => {
        results.set(address, batchResults[index]);
      });

      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Helper: Create empty metrics structure
   */
  private createEmptyMetrics(tokenAddress: string): LiquidityGrowthMetrics {
    return {
      tokenAddress,
      currentLiquiditySol: 0,
      growthRate1h: 0,
      growthRate6h: 0,
      growthRate24h: 0,
      accelerating: false,
      momentum: 'LOW',
      peakLiquidity: 0,
      timeToPeak: null
    };
  }

  /**
   * Get summary stats for all tracked tokens
   */
  getSummaryStats() {
    const metrics = Array.from(this.growthCache.values());
    
    return {
      totalTokens: metrics.length,
      highMomentum: metrics.filter((m: LiquidityGrowthMetrics) => m.momentum === 'HIGH').length,
      accelerating: metrics.filter((m: LiquidityGrowthMetrics) => m.accelerating).length,
      averageGrowthRate1h: metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.growthRate1h, 0) / metrics.length : 0,
      topGrowers: metrics
        .filter((m: LiquidityGrowthMetrics) => m.growthRate1h > 0)
        .sort((a: LiquidityGrowthMetrics, b: LiquidityGrowthMetrics) => b.growthRate1h - a.growthRate1h)
        .slice(0, 5)
        .map((m: LiquidityGrowthMetrics) => ({
          token: m.tokenAddress.substring(0, 8) + '...',
          growthRate: m.growthRate1h,
          momentum: m.momentum
        }))
    };
  }
}

// Export singleton instance
export const LIQUIDITY_GROWTH_TRACKER = new LiquidityGrowthTracker();