import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../utils/logger';
import { TokenMetrics } from './base-analyzer';

export class MetricsFetcher {
  private connection: Connection;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout = 60000; // 1 minute

  constructor() {
    this.connection = new Connection(config.apis.heliusRpcUrl);
  }

  async fetchMetrics(tokenAddress: string): Promise<TokenMetrics> {
    const metrics: TokenMetrics = {};
    
    // Try multiple sources in parallel
    const [birdeyeData, dexData, onChainData] = await Promise.allSettled([
      this.fetchFromBirdeye(tokenAddress),
      this.fetchFromDexScreener(tokenAddress),
      this.fetchOnChainData(tokenAddress),
    ]);

    // Merge data from successful sources
    if (birdeyeData.status === 'fulfilled' && birdeyeData.value) {
      Object.assign(metrics, this.extractBirdeyeMetrics(birdeyeData.value));
    }

    if (dexData.status === 'fulfilled' && dexData.value) {
      Object.assign(metrics, this.extractDexMetrics(dexData.value));
    }

    if (onChainData.status === 'fulfilled' && onChainData.value) {
      Object.assign(metrics, onChainData.value);
    }

    logger.debug(`Fetched metrics for ${tokenAddress}:`, metrics);
    return metrics;
  }

  private async fetchFromBirdeye(tokenAddress: string): Promise<any> {
    try {
      const cached = this.getFromCache(`birdeye-${tokenAddress}`);
      if (cached) return cached;

      const response = await axios.get(
        `https://public-api.birdeye.so/defi/token_overview`,
        {
          headers: { 'X-API-KEY': config.apis.birdeyeApiKey },
          params: { address: tokenAddress },
          timeout: 5000,
        }
      );

      this.setCache(`birdeye-${tokenAddress}`, response.data);
      return response.data;
    } catch (error: any) {
      logger.debug(`Birdeye API error for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  private async fetchFromDexScreener(tokenAddress: string): Promise<any> {
    try {
      const cached = this.getFromCache(`dex-${tokenAddress}`);
      if (cached) return cached;

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );

      this.setCache(`dex-${tokenAddress}`, response.data);
      return response.data;
    } catch (error: any) {
      logger.debug(`DexScreener API error for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  private async fetchOnChainData(tokenAddress: string): Promise<TokenMetrics> {
    try {
      const mint = new PublicKey(tokenAddress);
      const supply = await this.connection.getTokenSupply(mint);
      
      return {
        // We'll calculate market cap later if we have price
      };
    } catch (error: any) {
      logger.debug(`On-chain data error for ${tokenAddress}:`, error.message);
      return {};
    }
  }

  private extractBirdeyeMetrics(data: any): TokenMetrics {
    const tokenData = data?.data || data;
    return {
      price: tokenData.price || tokenData.v,
      marketCap: tokenData.mc,
      volume24h: tokenData.v24hUSD,
      liquidity: tokenData.liquidity,
      priceChange24h: tokenData.v24hChangePercent,
    };
  }

  private extractDexMetrics(data: any): TokenMetrics {
    const metrics: TokenMetrics = {};
    
    if (data.pairs && data.pairs.length > 0) {
      // Use the pair with highest liquidity
      const bestPair = data.pairs.reduce((best: any, pair: any) => 
        (pair.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? pair : best
      );

      metrics.price = parseFloat(bestPair.priceUsd) || undefined;
      metrics.volume24h = bestPair.volume?.h24 || undefined;
      metrics.liquidity = bestPair.liquidity?.usd || undefined;
      metrics.priceChange24h = bestPair.priceChange?.h24 || undefined;
      metrics.marketCap = bestPair.fdv || undefined;
    }

    return metrics;
  }

  private getFromCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}