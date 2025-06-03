import { TokenCategory, categoryConfig } from '../config/category-config';
import { SolSnifferClient } from '../api/solsniffer-client';
import { BirdeyeClient } from '../api/birdeye-client';
import { DexScreenerClient } from '../api/dexscreener-client';
import { MoralisClient } from '../api/moralis-client';
import { HeliusClient } from '../api/helius-client';
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
  
  private dailyCosts: Map<string, number> = new Map();
  
  constructor() {
    this.solsniffer = new SolSnifferClient(config.apis.solsnifferApiKey);
    this.birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
    this.dexscreener = new DexScreenerClient();
    this.moralis = new MoralisClient(config.apis.moralisApiKey);
    this.helius = new HeliusClient(config.apis.heliusRpcUrl);
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
    
    // Use free/cheap APIs only
    const [dexData, birdeyeData] = await Promise.allSettled([
      this.dexscreener.getTokenPairs(tokenAddress),
      this.birdeye.getTokenOverview(tokenAddress)
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
      marketData.liquidity = parseFloat(pair.liquidity?.toString() || '0');
      marketData.volume24h = parseFloat(pair.volume24h?.toString() || '0');
      apisUsed.push('dexscreener');
    }
    
    // Birdeye (if DexScreener missing data)
    if (birdeyeData.status === 'fulfilled' && birdeyeData.value) {
      const data = birdeyeData.value;
      if (marketData.marketCap === 0) marketData.marketCap = data.marketCap || 0;
      if (marketData.price === 0) marketData.price = (data as any).price || 0;
      if (marketData.liquidity === 0) marketData.liquidity = data.liquidity || 0;
      if (marketData.volume24h === 0) marketData.volume24h = data.volume24h || 0;
      marketData.holders = data.holders || 0;
      apisUsed.push('birdeye');
      costIncurred += 0.005; // Birdeye cost
    }
    
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
      holderData
    ] = await Promise.allSettled([
      this.dexscreener.getTokenPairs(tokenAddress),
      this.birdeye.getTokenOverview(tokenAddress),
      this.solsniffer.analyzeToken(tokenAddress),
      this.getTop10Concentration(tokenAddress)
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
      marketData.liquidity = parseFloat(pair.liquidity?.toString() || '0');
      marketData.volume24h = parseFloat(pair.volume24h?.toString() || '0');
      apisUsed.push('dexscreener');
    }
    
    // Birdeye
    if (birdeyeData.status === 'fulfilled' && birdeyeData.value) {
      const data = birdeyeData.value;
      if (marketData.marketCap === 0) marketData.marketCap = data.marketCap || 0;
      if (marketData.price === 0) marketData.price = (data as any).price || 0;
      if (marketData.liquidity === 0) marketData.liquidity = data.liquidity || 0;
      if (marketData.volume24h === 0) marketData.volume24h = data.volume24h || 0;
      marketData.holders = data.holders || 0;
      apisUsed.push('birdeye');
      costIncurred += 0.005;
    }
    
    // SolSniffer (expensive - AIM only)
    if (solsnifferData.status === 'fulfilled' && solsnifferData.value) {
      const data = solsnifferData.value;
      securityData.solsnifferScore = Math.round((1 - data.rugPullRisk) * 100);
      securityData.securityFlags = {
        rugPullRisk: data.rugPullRisk,
        honeypot: (data as any).honeypot || false,
        liquidityLocked: data.liquidityLocked,
        mintDisabled: data.mintAuthorityRenounced,
        freezeDisabled: (data as any).freezeAuthorityRenounced || false,
      };
      apisUsed.push('solsniffer');
      costIncurred += 0.01;
      
      // Track SolSniffer usage
      await this.trackSolSnifferUsage(tokenAddress, securityData.solsnifferScore);
    }
    
    // Top 10 concentration
    if (holderData.status === 'fulfilled') {
      securityData.top10Percent = holderData.value || 0;
    }
    
    // Update database with full data
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
      // Try Helius first
      const holders = await (this.helius as any).getTokenHolders(tokenAddress, 10);
      if (holders && holders.length > 0) {
        const totalSupply = holders.reduce((sum: number, h: any) => sum + (h.amount || 0), 0);
        const top10Amount = holders.slice(0, 10).reduce((sum: number, h: any) => sum + (h.amount || 0), 0);
        return totalSupply > 0 ? (top10Amount / totalSupply) * 100 : 0;
      }
    } catch (error) {
      logger.debug('Failed to get holder data:', error);
    }
    
    return 0;
  }
  
   //date token data in database
  private async updateTokenData(
    tokenAddress: string,
    marketData: any,
    category: TokenCategory,
    securityData?: any
  ): Promise<void> {
    try {
      // Log incoming data
      logger.info(`[DEBUG] updateTokenData called for ${tokenAddress}`);
      logger.info(`[DEBUG] Market data:`, {
        marketCap: marketData.marketCap,
        price: marketData.price,
        liquidity: marketData.liquidity,
        volume24h: marketData.volume24h
      });

      const updateData: any = {
        market_cap: marketData.marketCap || 0,
        current_price: marketData.price || 0,
        liquidity: marketData.liquidity || 0,
        volume_24h: marketData.volume24h || 0,
        holders: marketData.holders || null,
        updated_at: new Date(),
      };

      logger.info(`[DEBUG] Update data prepared:`, updateData);

      if (securityData) {
        updateData.solsniffer_score = securityData.solsnifferScore;
        updateData.solsniffer_checked_at = new Date();
        updateData.top_10_percent = securityData.top10Percent;
      }

    // Execute update
      const result = await db('tokens')
        .where('address', tokenAddress)
        .update(updateData);

      logger.info(`[DEBUG] Database update result: ${result} rows affected`);

    // Verify update
      const updated = await db('tokens')
        .where('address', tokenAddress)
        .select('market_cap', 'liquidity', 'volume_24h', 'updated_at')
        .first();

      logger.info(`[DEBUG] Verified database values:`, updated);

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
      logger.error(`[DEBUG] Error in updateTokenData for ${tokenAddress}:`, error);
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