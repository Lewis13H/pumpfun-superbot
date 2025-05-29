// src/analysis/token-enrichment-service.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { DexScreenerClient, DexScreenerPair } from '../api/dexscreener-client';
import { BirdeyeClient } from '../api/birdeye-client';
import { HeliusClient } from '../api/helius-client';
import { config } from '../config';

export class TokenEnrichmentService extends EventEmitter {
  private dexScreener: DexScreenerClient;
  private birdeye: BirdeyeClient;
  private helius: HeliusClient;
  private enrichmentQueue: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor() {
    super();
    this.dexScreener = new DexScreenerClient();
    this.birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
    this.helius = new HeliusClient(config.apis.heliusRpcUrl);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    logger.info('Starting Token Enrichment Service...');
    this.isRunning = true;

    // Process queue every 5 seconds
    setInterval(() => {
      if (this.enrichmentQueue.size > 0) {
        this.processQueue();
      }
    }, 5000);

    // Initial enrichment of tokens without metrics
    await this.enrichExistingTokens();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('Token Enrichment Service stopped');
  }

  async enrichToken(tokenAddress: string): Promise<void> {
    if (!tokenAddress) return;
    
    this.enrichmentQueue.add(tokenAddress);
    logger.debug(`Token ${tokenAddress} added to enrichment queue`);
  }

  private async processQueue(): Promise<void> {
    const tokensToProcess = Array.from(this.enrichmentQueue).slice(0, 10);
    
    for (const tokenAddress of tokensToProcess) {
      this.enrichmentQueue.delete(tokenAddress);
      
      try {
        await this.enrichSingleToken(tokenAddress);
      } catch (error) {
        logger.error(`Failed to enrich token ${tokenAddress}:`, error);
      }
    }
  }

  private async enrichSingleToken(tokenAddress: string): Promise<void> {
    logger.info(`Enriching token: ${tokenAddress}`);

    try {
      // Fetch data from multiple sources
      const [dexData, tokenInfo] = await Promise.allSettled([
        this.dexScreener.getTokenPairs(tokenAddress),
        this.getTokenInfo(tokenAddress)
      ]);

      // Parse DexScreener data
      let marketData: any = {
        marketCap: 0,
        price: 0,
        liquidity: 0,
        volume24h: 0,
        priceChange24h: 0,
        holders: 0
      };

      if (dexData.status === 'fulfilled' && dexData.value && dexData.value.length > 0) {
        const primaryPair = dexData.value[0];
        marketData = {
          marketCap: parseFloat(primaryPair.fdv?.toString() || '0'),
          price: parseFloat(primaryPair.priceUsd?.toString() || '0'),
          liquidity: parseFloat(primaryPair.liquidity?.toString() || '0'),
          volume24h: parseFloat(primaryPair.volume24h?.toString() || '0'),
          priceChange24h: parseFloat(primaryPair.priceChange24h?.toString() || '0'),
          holders: 0 // DexScreener doesn't provide holder count
        };
      }

      // Update token table with basic data
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          market_cap: marketData.marketCap,
          current_price: marketData.price,
          liquidity: marketData.liquidity,
          volume_24h: marketData.volume24h,
          price_change_24h: marketData.priceChange24h,
          updated_at: new Date()
        });

      // Create or update enhanced metrics
      const graduationDistance = this.calculateGraduationDistance(marketData.marketCap);
      const volumeToLiquidityRatio = marketData.liquidity > 0 ? marketData.volume24h / marketData.liquidity : 0;

      await db('enhanced_token_metrics')
        .insert({
          token_address: tokenAddress,
          market_cap: marketData.marketCap,
          market_cap_trend: 'UNKNOWN',
          market_cap_velocity: 0,
          graduation_distance: graduationDistance,
          total_liquidity: marketData.liquidity,
          liquidity_locked_percentage: 0,
          lp_burned: false,
          slippage_1k: 0,
          liquidity_to_mc_ratio: marketData.marketCap > 0 ? marketData.liquidity / marketData.marketCap : 0,
          volume_24h: marketData.volume24h,
          volume_trend: 'UNKNOWN',
          volume_to_liquidity_ratio: volumeToLiquidityRatio,
          unique_traders_24h: 0,
          avg_trade_size: 0,
          buy_count_24h: 0,
          sell_count_24h: 0,
          buy_pressure: 0.5,
          total_tx_count_24h: 0,
          large_tx_count_24h: 0,
          price_change_24h: marketData.priceChange24h,
          holder_count: marketData.holders,
          last_updated: new Date()
        })
        .onConflict('token_address')
        .merge([
          'market_cap',
          'total_liquidity',
          'volume_24h',
          'price_change_24h',
          'graduation_distance',
          'liquidity_to_mc_ratio',
          'volume_to_liquidity_ratio',
          'last_updated'
        ]);

      logger.info(`Token ${tokenAddress} enriched successfully with market cap: $${marketData.marketCap}`);
      
      // Emit event for other services
      this.emit('tokenEnriched', {
        address: tokenAddress,
        marketCap: marketData.marketCap,
        price: marketData.price,
        liquidity: marketData.liquidity,
        volume24h: marketData.volume24h
      });

    } catch (error) {
      logger.error(`Error enriching token ${tokenAddress}:`, error);
      throw error;
    }
  }

  private async enrichExistingTokens(): Promise<void> {
    try {
      // Find tokens without market data
      const tokensWithoutMetrics = await db('tokens')
        .leftJoin('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
        .whereNull('enhanced_token_metrics.token_address')
        .orWhere('enhanced_token_metrics.market_cap', 0)
        .select('tokens.address')
        .limit(100);

      logger.info(`Found ${tokensWithoutMetrics.length} tokens without market data`);

      for (const token of tokensWithoutMetrics) {
        this.enrichmentQueue.add(token.address);
      }
    } catch (error) {
      logger.error('Error finding tokens without metrics:', error);
    }
  }

  private async getTokenInfo(tokenAddress: string): Promise<any> {
    return db('tokens')
      .where('address', tokenAddress)
      .first();
  }

  private calculateGraduationDistance(marketCap: number): number {
    const graduationThreshold = 69000; // $69K
    if (marketCap >= graduationThreshold) return 1.0;
    if (marketCap <= 0) return 0.0;
    return marketCap / graduationThreshold;
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      queueSize: this.enrichmentQueue.size
    };
  }
}