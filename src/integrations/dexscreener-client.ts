// src/integrations/dexscreener-client.ts
import { BaseAPIClient } from './base-api-client';
import { DexScreenerTokenResponse, DexScreenerPair, TokenMarketData } from './types';
import { logger } from '../utils/logger';

export class DexScreenerClient extends BaseAPIClient {
  constructor() {
    super(
      'DexScreener',
      'https://api.dexscreener.com/latest/dex',
      {
        maxRequests: 30, // DexScreener is quite generous
        windowMs: 60000,
        retryAfter: 60000,
      }
    );
  }

  async getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
    try {
      logger.debug(`Fetching DexScreener pairs for ${tokenAddress}`);
      
      const response = await this.makeRequest<DexScreenerTokenResponse>({
        method: 'GET',
        url: `/tokens/${tokenAddress}`,
      });

      if (!response?.pairs || response.pairs.length === 0) {
        logger.warn(`No DexScreener pairs found for ${tokenAddress}`);
        return [];
      }

      // Filter for Solana pairs only
      const solanaPairs = response.pairs.filter(
        pair => pair.chainId === 'solana'
      );

      logger.info(`Found ${solanaPairs.length} Solana pairs for ${tokenAddress}`);
      return solanaPairs;
    } catch (error: any) {
      logger.error(`DexScreener API error for ${tokenAddress}:`, {
        message: error.message,
        status: error.response?.status,
      });
      return [];
    }
  }

  async getTokenByPairAddress(pairAddress: string): Promise<DexScreenerPair | null> {
    try {
      logger.debug(`Fetching DexScreener pair ${pairAddress}`);
      
      const response = await this.makeRequest<{ pair: DexScreenerPair }>({
        method: 'GET',
        url: `/pairs/solana/${pairAddress}`,
      });

      if (!response?.pair) {
        logger.warn(`No pair data found for ${pairAddress}`);
        return null;
      }

      return response.pair;
    } catch (error: any) {
      logger.error(`DexScreener pair API error for ${pairAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  async searchTokens(query: string): Promise<DexScreenerPair[]> {
    try {
      const response = await this.makeRequest<{ pairs: DexScreenerPair[] }>({
        method: 'GET',
        url: '/search',
        params: { q: query },
      });

      if (!response?.pairs) return [];

      // Filter for Solana tokens
      return response.pairs.filter(pair => pair.chainId === 'solana');
    } catch (error: any) {
      logger.error(`DexScreener search error for "${query}":`, {
        message: error.message,
      });
      return [];
    }
  }

  // Get the best trading pair (highest liquidity)
  getBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
    if (pairs.length === 0) return null;

    return pairs.reduce((best, current) => {
      const bestLiquidity = best.liquidity?.usd || 0;
      const currentLiquidity = current.liquidity?.usd || 0;
      return currentLiquidity > bestLiquidity ? current : best;
    });
  }

  // Calculate aggregate market data from all pairs
  calculateAggregateMarketData(pairs: DexScreenerPair[]): TokenMarketData {
    if (pairs.length === 0) {
      return {
        price: { usd: 0 },
        marketCap: 0,
        volume24h: 0,
        liquidity: 0,
      };
    }

    // Use the best pair for price
    const bestPair = this.getBestPair(pairs);
    if (!bestPair) {
      return {
        price: { usd: 0 },
        marketCap: 0,
        volume24h: 0,
        liquidity: 0,
      };
    }

    // Aggregate volume and liquidity across all pairs
    const totalVolume24h = pairs.reduce(
      (sum, pair) => sum + (pair.volume?.h24 || 0),
      0
    );
    const totalLiquidity = pairs.reduce(
      (sum, pair) => sum + (pair.liquidity?.usd || 0),
      0
    );

    return {
      price: {
        usd: parseFloat(bestPair.priceUsd || '0'),
        change24h: bestPair.priceChange?.h24,
        change7d: undefined, // DexScreener doesn't provide 7d change
        change30d: undefined,
      },
      marketCap: bestPair.fdv || 0,
      volume24h: totalVolume24h,
      liquidity: totalLiquidity,
      fdv: bestPair.fdv,
    };
  }

  // Get detailed trading metrics
  getTradingMetrics(pair: DexScreenerPair): {
    buyPressure: number;
    sellPressure: number;
    tradingActivity: number;
    priceStability: number;
  } {
    const txns24h = pair.txns?.h24 || { buys: 0, sells: 0 };
    const totalTxns = txns24h.buys + txns24h.sells;
    
    const buyPressure = totalTxns > 0 ? txns24h.buys / totalTxns : 0.5;
    const sellPressure = totalTxns > 0 ? txns24h.sells / totalTxns : 0.5;
    
    // Trading activity score based on transaction count
    const tradingActivity = Math.min(1, totalTxns / 1000);
    
    // Price stability based on recent price changes
    const avgChange = Math.abs(pair.priceChange?.h1 || 0) * 0.5 +
                     Math.abs(pair.priceChange?.h6 || 0) * 0.3 +
                     Math.abs(pair.priceChange?.h24 || 0) * 0.2;
    const priceStability = Math.max(0, 1 - avgChange / 100);
    
    return {
      buyPressure,
      sellPressure,
      tradingActivity,
      priceStability,
    };
  }

  // Check if token is trending
  async isTokenTrending(tokenAddress: string): Promise<{
    isTrending: boolean;
    metrics: {
      volumeIncrease: boolean;
      priceIncrease: boolean;
      highActivity: boolean;
    };
  }> {
    const pairs = await this.getTokenPairs(tokenAddress);
    if (pairs.length === 0) {
      return {
        isTrending: false,
        metrics: {
          volumeIncrease: false,
          priceIncrease: false,
          highActivity: false,
        },
      };
    }

    const bestPair = this.getBestPair(pairs);
    if (!bestPair) {
      return {
        isTrending: false,
        metrics: {
          volumeIncrease: false,
          priceIncrease: false,
          highActivity: false,
        },
      };
    }

    // Check various trending indicators
    const volumeIncrease = (bestPair.volume?.h6 || 0) > (bestPair.volume?.h24 || 0) / 4;
    const priceIncrease = (bestPair.priceChange?.h6 || 0) > 10;
    const highActivity = (bestPair.txns?.h1?.buys || 0) + (bestPair.txns?.h1?.sells || 0) > 50;

    return {
      isTrending: volumeIncrease && (priceIncrease || highActivity),
      metrics: {
        volumeIncrease,
        priceIncrease,
        highActivity,
      },
    };
  }
}