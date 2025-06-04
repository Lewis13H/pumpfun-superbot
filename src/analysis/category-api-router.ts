import { TokenCategory, categoryConfig } from '../config/category-config';
import { SolSnifferClient } from '../api/solsniffer-client';
import { BirdeyeClient } from '../api/birdeye-client';
import { DexScreenerClient } from '../api/dexscreener-client';
import { MoralisClient } from '../api/moralis-client';
import { HeliusClient } from '../api/helius-client';
import { RaydiumClient } from '../api/raydium-client';
import { logger } from '../utils/logger';
import { config } from '../config';
import { db } from '../database/postgres';

export interface CategoryAnalysisResult {
  tokenAddress: string;
  category: TokenCategory;
  timestamp: Date;
  
  // Market data
  marketCap: number;
  price: number;
  liquidity: number;
  volume24h: number;
  holders?: number;
  
  // Security data (AIM only)
  solsnifferScore?: number;
  securityFlags?: any;
  top10Percent?: number;
  
  // Metadata
  apisUsed: string[];
  costIncurred: number;
  processingTime: number;
  analysisType: 'basic' | 'full';
}

export class CategoryAPIRouter {
  private solsniffer: SolSnifferClient;
  private birdeye: BirdeyeClient;
  private dexscreener: DexScreenerClient;
  private moralis: MoralisClient;
  private helius: HeliusClient;
  private raydium: RaydiumClient;
  
  private dailyCosts: Map<string, number> = new Map();
  
  constructor() {
    this.solsniffer = new SolSnifferClient(config.apis.solsnifferApiKey);
    this.birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
    this.dexscreener = new DexScreenerClient();
    this.moralis = new MoralisClient(config.apis.moralisApiKey);
    this.helius = new HeliusClient(config.apis.heliusRpcUrl);
    this.raydium = new RaydiumClient();
  }
  
  /**
   * Analyze token based on category
   */
  async analyzeToken(
    tokenAddress: string,
    category: TokenCategory,
    forceFullAnalysis: boolean = false
  ): Promise<CategoryAnalysisResult> {
    const startTime = Date.now();
    
    // Determine analysis type
    const useFullAnalysis = forceFullAnalysis || category === 'AIM';
    
    logger.info(`Analyzing ${tokenAddress} (${category}) - ${useFullAnalysis ? 'FULL' : 'BASIC'} analysis`);
    
    try {
      if (useFullAnalysis && category === 'AIM') {
        return await this.performFullAnalysis(tokenAddress, category, startTime);
      } else {
        return await this.performBasicAnalysis(tokenAddress, category, startTime);
      }
    } catch (error) {
      logger.error(`Analysis failed for ${tokenAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Basic analysis - no expensive APIs
   */
  private async performBasicAnalysis(
    tokenAddress: string,
    category: TokenCategory,
    startTime: number
  ): Promise<CategoryAnalysisResult> {
    const apisUsed: string[] = [];
    let costIncurred = 0;
    
    // Use multiple APIs for better data coverage
    const [dexData, birdeyeData, heliusHolders, raydiumData] = await Promise.allSettled([
      this.dexscreener.getTokenPairs(tokenAddress),
      this.birdeye.getTokenOverview(tokenAddress),
      this.helius.getTokenHolders(tokenAddress, 20), // Get top 20 holders
      this.raydium.getPoolInfo(tokenAddress)
    ]);
    
    // Parse results
    let marketData = {
      marketCap: 0,
      price: 0,
      liquidity: 0,
      volume24h: 0,
      holders: 0,
    };
    
    // DexScreener (free)
    if (dexData.status === 'fulfilled' && dexData.value?.length > 0) {
      const pair = dexData.value[0];
      marketData.marketCap = parseFloat(pair.fdv?.toString() || '0');
      marketData.price = parseFloat(pair.priceUsd?.toString() || '0');
      
      // Handle liquidity - can be object or number
      if (pair.liquidity) {
        if (typeof pair.liquidity === 'object' && pair.liquidity !== null) {
          // Type assertion to handle the object structure
          const liq = pair.liquidity as any;
          marketData.liquidity = parseFloat(liq.usd?.toString() || '0');
        } else {
          marketData.liquidity = parseFloat(pair.liquidity?.toString() || '0');
        }
      }
      
      // Handle volume24h
      if (pair.volume24h) {
        marketData.volume24h = parseFloat(pair.volume24h?.toString() || '0');
      } else if ((pair as any).volume) {
        // Some responses have volume as an object
        const vol = (pair as any).volume;
        if (typeof vol === 'object' && vol !== null && vol.h24) {
          marketData.volume24h = parseFloat(vol.h24?.toString() || '0');
        }
      }
      
      apisUsed.push('dexscreener');
      
      logger.debug(`[DexScreener] Data for ${tokenAddress}:`, {
        marketCap: marketData.marketCap,
        liquidity: marketData.liquidity,
        volume24h: marketData.volume24h,
        rawLiquidity: pair.liquidity,
        rawVolume: (pair as any).volume || pair.volume24h
      });
    }
    
    // Birdeye - override with Birdeye data if available
    if (birdeyeData.status === 'fulfilled' && birdeyeData.value) {
      const data = birdeyeData.value;
      
      // Only override if we have valid data
      if (data.marketCap > 0) marketData.marketCap = data.marketCap;
      if (data.price > 0) marketData.price = data.price;
      if (data.liquidity > 0) marketData.liquidity = data.liquidity;
      if (data.volume24h > 0) marketData.volume24h = data.volume24h;
      if (data.holders > 0) marketData.holders = data.holders;
      
      apisUsed.push('birdeye');
      costIncurred += 0.005;
      
      logger.debug(`[Birdeye] Data for ${tokenAddress}:`, {
        marketCap: data.marketCap,
        liquidity: data.liquidity,
        holders: data.holders
      });
    }
    
    // Raydium - another source for liquidity
    if (raydiumData.status === 'fulfilled' && raydiumData.value) {
      const data = raydiumData.value;
      
      // Use Raydium liquidity if we don't have it from other sources
      if (marketData.liquidity === 0 && data.liquidity > 0) {
        marketData.liquidity = data.liquidity;
      }
      if (marketData.volume24h === 0 && data.volume24h > 0) {
        marketData.volume24h = data.volume24h;
      }
      
      apisUsed.push('raydium');
      
      logger.debug(`[Raydium] Data for ${tokenAddress}:`, {
        liquidity: data.liquidity,
        volume24h: data.volume24h
      });
    }
    
    // Get holder count from Helius if not available
    if (heliusHolders.status === 'fulfilled' && heliusHolders.value && heliusHolders.value.length > 0) {
      // If we don't have holder count from Birdeye, estimate from Helius data
      if (marketData.holders === 0) {
        // This is an estimate - if we have top 20 holders, actual count is likely higher
        marketData.holders = Math.max(heliusHolders.value.length * 5, 50);
      }
      apisUsed.push('helius-holders');
    }
    
    // Log final market data
    logger.info(`[Analysis] Final data for ${tokenAddress}:`, {
      marketCap: marketData.marketCap,
      liquidity: marketData.liquidity,
      holders: marketData.holders,
      volume24h: marketData.volume24h,
      apisUsed
    });
    
    // Update database with basic data
    await this.updateTokenData(tokenAddress, marketData, category);
    
    return {
      tokenAddress,
      category,
      timestamp: new Date(),
      ...marketData,
      apisUsed,
      costIncurred,
      processingTime: Date.now() - startTime,
      analysisType: 'basic',
    };
  }
  
  /**
   * Full analysis - all APIs including SolSniffer
   */
  private async performFullAnalysis(
    tokenAddress: string,
    category: TokenCategory,
    startTime: number
  ): Promise<CategoryAnalysisResult> {
    const apisUsed: string[] = [];
    let costIncurred = 0;
    
    // Call all APIs including expensive ones
    const [
      dexData,
      birdeyeData,
      solsnifferData,
      holderData,
      raydiumData
    ] = await Promise.allSettled([
      this.dexscreener.getTokenPairs(tokenAddress),
      this.birdeye.getTokenOverview(tokenAddress),
      this.solsniffer.analyzeToken(tokenAddress),
      this.getTop10Concentration(tokenAddress),
      this.raydium.getPoolInfo(tokenAddress)
    ]);
    
    // Parse results
    let marketData = {
      marketCap: 0,
      price: 0,
      liquidity: 0,
      volume24h: 0,
      holders: 0,
    };
    
    let securityData = {
      solsnifferScore: 0,
      securityFlags: {},
      top10Percent: 0,
    };
    
    // DexScreener (free)
    if (dexData.status === 'fulfilled' && dexData.value?.length > 0) {
      const pair = dexData.value[0];
      marketData.marketCap = parseFloat(pair.fdv?.toString() || '0');
      marketData.price = parseFloat(pair.priceUsd?.toString() || '0');
      
      // Handle liquidity - can be object or number
      if (pair.liquidity) {
        if (typeof pair.liquidity === 'object' && pair.liquidity !== null) {
          // Type assertion to handle the object structure
          const liq = pair.liquidity as any;
          marketData.liquidity = parseFloat(liq.usd?.toString() || '0');
        } else {
          marketData.liquidity = parseFloat(pair.liquidity?.toString() || '0');
        }
      }
      
      // Handle volume24h
      if (pair.volume24h) {
        marketData.volume24h = parseFloat(pair.volume24h?.toString() || '0');
      } else if ((pair as any).volume) {
        // Some responses have volume as an object
        const vol = (pair as any).volume;
        if (typeof vol === 'object' && vol !== null && vol.h24) {
          marketData.volume24h = parseFloat(vol.h24?.toString() || '0');
        }
      }
      
      apisUsed.push('dexscreener');
    }
    
    // Birdeye
    if (birdeyeData.status === 'fulfilled' && birdeyeData.value) {
      const data = birdeyeData.value;
      if (data.marketCap > 0) marketData.marketCap = data.marketCap;
      if (data.price > 0) marketData.price = data.price;
      if (data.liquidity > 0) marketData.liquidity = data.liquidity;
      if (data.volume24h > 0) marketData.volume24h = data.volume24h;
      if (data.holders > 0) marketData.holders = data.holders;
      apisUsed.push('birdeye');
      costIncurred += 0.005;
    }
    
    // Raydium - additional liquidity source
    if (raydiumData.status === 'fulfilled' && raydiumData.value) {
      const data = raydiumData.value;
      if (marketData.liquidity === 0 && data.liquidity > 0) {
        marketData.liquidity = data.liquidity;
      }
      if (marketData.volume24h === 0 && data.volume24h > 0) {
        marketData.volume24h = data.volume24h;
      }
      apisUsed.push('raydium');
    }
    
    // SolSniffer (expensive - AIM only)
    if (solsnifferData.status === 'fulfilled' && solsnifferData.value) {
      const data = solsnifferData.value;
      
      // Use the ACTUAL safety score from SolSniffer (not calculated from rugPullRisk)
      securityData.solsnifferScore = data.score;
      
      // Store ALL security data
      securityData.securityFlags = {
        rugPullRisk: data.rugPullRisk,
        honeypot: data.honeypot,
        liquidityLocked: data.liquidityLocked,
        lpBurned: data.lpBurned,
        mintDisabled: data.mintAuthorityRenounced,
        freezeDisabled: data.freezeAuthorityRenounced,
        topHolderPercentage: data.topHolderPercentage,
        riskLevel: data.riskLevel,
        warnings: data.warnings,
        highRiskCount: data.highRiskCount,
        mediumRiskCount: data.mediumRiskCount,
        lowRiskCount: data.lowRiskCount,
        specificRisks: data.specificRisks,
        rawIndicatorData: data.rawIndicatorData,
        tokenInfo: data.tokenInfo
      };
      
      apisUsed.push('solsniffer');
      costIncurred += 0.01;
      
      // Track SolSniffer usage with score
      await this.trackSolSnifferUsage(tokenAddress, securityData.solsnifferScore);
      
      logger.info(`[SOLSNIFFER] Score for ${tokenAddress}: ${securityData.solsnifferScore}`, {
        riskLevel: data.riskLevel,
        warnings: data.warnings.length,
        risks: {
          high: data.highRiskCount,
          medium: data.mediumRiskCount,
          low: data.lowRiskCount
        }
      });
    }
    
    // Top 10 concentration
    if (holderData.status === 'fulfilled') {
      securityData.top10Percent = holderData.value || 0;
    }
    
    // Log final analysis results
    logger.info(`[Full Analysis] Complete data for ${tokenAddress}:`, {
      marketCap: marketData.marketCap,
      liquidity: marketData.liquidity,
      holders: marketData.holders,
      solsnifferScore: securityData.solsnifferScore,
      top10Percent: securityData.top10Percent
    });
    
    // Update database with full data including ALL security information
    await this.updateTokenData(tokenAddress, marketData, category, securityData);
    
    // Track costs
    this.trackDailyCost(costIncurred);
    
    return {
      tokenAddress,
      category,
      timestamp: new Date(),
      ...marketData,
      ...securityData,
      apisUsed,
      costIncurred,
      processingTime: Date.now() - startTime,
      analysisType: 'full',
    };
  }
  
  /**
 * Get top 10 holder concentration
 */
private async getTop10Concentration(tokenAddress: string): Promise<number> {
  try {
    // Get holders and total supply
    const [holders, totalSupply] = await Promise.all([
      this.helius.getTokenHolders(tokenAddress, 10),
      this.helius.getTokenSupply(tokenAddress)
    ]);
    
    if (holders && holders.length > 0 && totalSupply > 0) {
      // Get token decimals (default to 9 for Solana tokens)
      const decimals = 9; // Most Solana tokens use 9 decimals
      const divisor = Math.pow(10, decimals);
      
      // Calculate top 10 amount, ensuring we parse as numbers and handle decimals
      const top10Amount = holders.reduce((sum: number, h: any) => {
        const amount = typeof h.amount === 'string' ? parseFloat(h.amount) : h.amount;
        return sum + (amount || 0);
      }, 0);
      
      // Both amounts should be in the same unit (smallest unit)
      // So we just divide by total supply
      let concentration = (top10Amount / totalSupply) * 100;
      
      // If concentration is still > 100%, it might mean totalSupply is already adjusted for decimals
      if (concentration > 100) {
        // Try adjusting top10Amount for decimals
        const adjustedTop10 = top10Amount / divisor;
        const adjustedConcentration = (adjustedTop10 / totalSupply) * 100;
        
        if (adjustedConcentration <= 100) {
          concentration = adjustedConcentration;
        } else {
          // If still > 100%, try adjusting totalSupply
          const adjustedSupply = totalSupply / divisor;
          concentration = (top10Amount / adjustedSupply) * 100;
        }
      }
      
      // Ensure the value fits in DECIMAL(5,2) - max 999.99
      if (concentration > 100) {
        logger.warn(`[Top10] Invalid concentration ${concentration}% for ${tokenAddress}, capping at 100%`);
        concentration = 100;
      }
      
      // Round to 2 decimal places
      concentration = Math.round(concentration * 100) / 100;
      
      logger.debug(`[Top10] ${tokenAddress}: ${concentration}% (${top10Amount}/${totalSupply})`);
      
      return concentration;
    }
  } catch (error) {
    logger.error(`Failed to get top 10 concentration for ${tokenAddress}:`, error);
  }
  
  return 0;
}
  
  /**
   * Update token data in database
   */
  private async updateTokenData(
    tokenAddress: string,
    marketData: any,
    category: TokenCategory,
    securityData?: any
  ): Promise<void> {
    try {
      // Log incoming data
      logger.info(`[DB] Updating token ${tokenAddress}`);
      
      const updateData: any = {
        market_cap: marketData.marketCap || 0,
        current_price: marketData.price || 0,
        liquidity: marketData.liquidity || 0,
        volume_24h: marketData.volume24h || 0,
        holders: marketData.holders || null,
        updated_at: new Date(),
      };

      if (securityData && securityData.solsnifferScore !== undefined) {
        // Save the SolSniffer score (0-100 where 100 is safest)
        updateData.solsniffer_score = securityData.solsnifferScore;
        updateData.solsniffer_checked_at = new Date();
        
        // Ensure top_10_percent fits in DECIMAL(5,2)
        let top10 = securityData.top10Percent || 0;
        if (top10 > 100) {
          logger.warn(`[DB] Top 10 concentration ${top10}% exceeds 100%, capping at 100%`);
          top10 = 100;
        }
        updateData.top_10_percent = Math.round(top10 * 100) / 100; // Round to 2 decimals
        
        // Save ALL security data in JSONB field
        if (securityData.securityFlags) {
          updateData.security_data = JSON.stringify(securityData.securityFlags);
        }
        
        logger.info(`[DB] Saving SolSniffer data for ${tokenAddress}:`, {
          score: updateData.solsniffer_score,
          top10Percent: updateData.top_10_percent,
          hasSecurityData: !!updateData.security_data
        });
      }

      // Log the update data
      logger.info(`[DB] Update data:`, {
        address: tokenAddress,
        marketCap: updateData.market_cap,
        liquidity: updateData.liquidity,
        holders: updateData.holders
      });

      // Execute update
      const result = await db('tokens')
        .where('address', tokenAddress)
        .update(updateData);

      logger.info(`[DB] Updated ${result} rows for ${tokenAddress}`);

      // Verify update if security data was included
      if (securityData) {
        const updated = await db('tokens')
          .where('address', tokenAddress)
          .select('solsniffer_score', 'solsniffer_checked_at', 'security_data')
          .first();

        logger.info(`[DB] Verified SolSniffer data:`, {
          score: updated.solsniffer_score,
          hasSecurityData: !!updated.security_data,
          checkedAt: updated.solsniffer_checked_at
        });
      }

      // Update enhanced metrics
      await db('enhanced_token_metrics')
        .insert({
          token_address: tokenAddress,
          market_cap: marketData.marketCap || 0,
          total_liquidity: marketData.liquidity || 0,
          volume_24h: marketData.volume24h || 0,
          holder_count: marketData.holders || 0,
          last_updated: new Date(),
        })
        .onConflict('token_address')
        .merge();

    } catch (error) {
      logger.error(`[DB] Error updating token ${tokenAddress}:`, error);
      throw error;
    }
  }
  
  /**
   * Track SolSniffer usage
   */
  private async trackSolSnifferUsage(tokenAddress: string, score: number): Promise<void> {
    await db('api_call_logs').insert({
      timestamp: new Date(),
      service: 'solsniffer',
      endpoint: 'analyzeToken',
      token_address: tokenAddress,
      cost: 0.01,
      response_time_ms: 0,
      status_code: 200,
      metadata: { score },
    });
  }
  
  /**
   * Track daily costs
   */
  private trackDailyCost(cost: number): void {
    const today = new Date().toISOString().split('T')[0];
    const current = this.dailyCosts.get(today) || 0;
    this.dailyCosts.set(today, current + cost);
  }
  
  /**
   * Get API usage statistics
   */
  getApiStats() {
    const today = new Date().toISOString().split('T')[0];
    return {
      dailyCost: this.dailyCosts.get(today) || 0,
      monthlyProjection: (this.dailyCosts.get(today) || 0) * 30,
      costsByApi: {
        solsniffer: 0, // TODO: Calculate from logs
        birdeye: 0,
        moralis: 0,
      },
    };
  }
  
  /**
   * Check if daily budget exceeded
   */
  isDailyBudgetExceeded(): boolean {
    const today = new Date().toISOString().split('T')[0];
    const dailyCost = this.dailyCosts.get(today) || 0;
    return dailyCost >= 20; // $20 daily limit
  }
}

// Export singleton instance
export const categoryAPIRouter = new CategoryAPIRouter();