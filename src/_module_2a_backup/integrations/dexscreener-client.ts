import { BaseAPIClient } from './base-api-client';
import { 
  TokenData, 
  MarketData, 
  HolderData, 
  LiquidityData, 
  SecurityData 
} from './types';
import { logger } from '../utils/logger';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export class DexScreenerClient extends BaseAPIClient {
  constructor() {
    super('dexscreener', {
      baseURL: 'https://api.dexscreener.com/latest',
      timeout: 15000,
      rateLimit: {
        maxRequests: 300, // DexScreener is generous
        windowMs: 60000, // 1 minute
      },
    });
  }

  async getTokenData(address: string): Promise<TokenData | null> {
    try {
      logger.debug(`Fetching DexScreener data for ${address}`);
      
      // DexScreener uses 'tokens' endpoint for Solana
      const response = await this.get<DexScreenerResponse>(
        `/dex/tokens/${address}`
      );

      if (!response.pairs || response.pairs.length === 0) {
        logger.debug(`No DexScreener data found for ${address}`);
        return null;
      }

      // Sort pairs by liquidity to get the main pair
      const pairs = response.pairs
        .filter(p => p.chainId === 'solana' && p.baseToken.address.toLowerCase() === address.toLowerCase())
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

      const mainPair = pairs[0];
      if (!mainPair) {
        return null;
      }

      // Aggregate data from all pairs
      const totalVolume24h = pairs.reduce((sum, p) => sum + (p.volume.h24 || 0), 0);
      const totalLiquidity = pairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);

      const tokenData: TokenData = {
        address,
        symbol: mainPair.baseToken.symbol,
        name: mainPair.baseToken.name,
        price: parseFloat(mainPair.priceUsd) || 0,
        marketCap: mainPair.fdv || 0,
        volume24h: totalVolume24h,
        liquidity: totalLiquidity,
        holders: 0, // DexScreener doesn't provide holder data
        priceChange24h: mainPair.priceChange.h24 || 0,
        
        // Additional fields
        pairs: pairs.length,
        mainPairAddress: mainPair.pairAddress,
        dexId: mainPair.dexId,
        pairCreatedAt: mainPair.pairCreatedAt 
          ? new Date(mainPair.pairCreatedAt) 
          : undefined,
      };

      logger.info(`DexScreener data fetched for ${mainPair.baseToken.symbol}: $${mainPair.priceUsd}`);
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`Token ${address} not found on DexScreener`);
        return null;
      }
      logger.error(`DexScreener API error for ${address}:`, error.message);
      throw error;
    }
  }

  async getMarketData(address: string): Promise<MarketData | null> {
    const tokenData = await this.getTokenData(address);
    if (!tokenData) return null;

    return {
      price: tokenData.price,
      marketCap: tokenData.marketCap,
      volume24h: tokenData.volume24h,
      volume1h: 0, // Would need to aggregate from pairs
      priceChange24h: tokenData.priceChange24h || 0,
      priceChange1h: 0,
      high24h: 0, // Not provided by DexScreener
      low24h: 0,  // Not provided by DexScreener
    };
  }

  async getLiquidityData(address: string): Promise<LiquidityData | null> {
    const tokenData = await this.getTokenData(address);
    if (!tokenData) return null;

    return {
      totalLiquidityUSD: tokenData.liquidity || 0,
      poolCount: tokenData.pairs || 0,
      mainPool: {
        address: tokenData.mainPairAddress || '',
        dex: tokenData.dexId || 'unknown',
        liquidityUSD: tokenData.liquidity || 0,
        volume24h: tokenData.volume24h,
      },
    };
  }

  async getHolderData(address: string): Promise<HolderData | null> {
    // DexScreener doesn't provide holder data
    return null;
  }

  async getSecurityData(address: string): Promise<SecurityData | null> {
    // DexScreener doesn't provide security data
    // But we can infer some things from the data
    const tokenData = await this.getTokenData(address);
    if (!tokenData) return null;

    // Basic heuristics
    const hasLiquidity = (tokenData.liquidity || 0) > 1000; // $1k minimum
    const hasVolume = (tokenData.volume24h || 0) > 100; // $100 minimum
    const isNew = tokenData.pairCreatedAt 
      ? (Date.now() - tokenData.pairCreatedAt.getTime()) < 86400000 // 24 hours
      : true;

    return {
      rugPullRisk: 0, // Can't determine from DexScreener
      honeypotRisk: !hasVolume, // If no volume, might be honeypot
      mintable: null,
      freezable: null,
      lpBurned: null,
      topHolderConcentration: 0,
      isVerified: false,
      hasWebsite: false,
      hasSocials: false,
      contractVerified: false,
      
      // Additional context
      hasMinimumLiquidity: hasLiquidity,
      isNewToken: isNew,
    };
  }

  // Batch fetch for multiple tokens (more efficient)
  async getMultipleTokens(addresses: string[]): Promise<Map<string, TokenData>> {
    const results = new Map<string, TokenData>();
    
    // DexScreener allows comma-separated addresses
    // But limit to 30 per request to be safe
    const chunks = [];
    for (let i = 0; i < addresses.length; i += 30) {
      chunks.push(addresses.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      try {
        const query = chunk.join(',');
        const response = await this.get<DexScreenerResponse>(
          `/dex/tokens/${query}`
        );

        if (response.pairs) {
          // Group pairs by token address
          const pairsByToken = new Map<string, DexScreenerPair[]>();
          
          for (const pair of response.pairs) {
            if (pair.chainId !== 'solana') continue;
            
            const tokenAddr = pair.baseToken.address;
            if (!pairsByToken.has(tokenAddr)) {
              pairsByToken.set(tokenAddr, []);
            }
            pairsByToken.get(tokenAddr)!.push(pair);
          }

          // Process each token
          for (const [tokenAddr, tokenPairs] of pairsByToken) {
            const mainPair = tokenPairs[0];
            const totalVolume = tokenPairs.reduce((sum, p) => sum + (p.volume.h24 || 0), 0);
            const totalLiquidity = tokenPairs.reduce((sum, p) => sum + (p.liquidity?.usd || 0), 0);

            results.set(tokenAddr, {
              address: tokenAddr,
              symbol: mainPair.baseToken.symbol,
              name: mainPair.baseToken.name,
              price: parseFloat(mainPair.priceUsd) || 0,
              marketCap: mainPair.fdv || 0,
              volume24h: totalVolume,
              liquidity: totalLiquidity,
              holders: 0,
              priceChange24h: mainPair.priceChange.h24 || 0,
              pairs: tokenPairs.length,
            });
          }
        }
      } catch (error) {
        logger.error('Error fetching batch from DexScreener:', error);
      }
    }

    return results;
  }
}