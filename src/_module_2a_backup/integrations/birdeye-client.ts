import { BaseAPIClient } from './base-api-client';
import { 
  TokenData, 
  MarketData, 
  HolderData, 
  LiquidityData, 
  SecurityData 
} from './types';
import { logger } from '../utils/logger';
import { config } from '../config';

interface BirdeyeTokenOverview {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  logoURI?: string;
  supply: number;
  v24hUSD: number;
  v24hChangePercent: number;
  mc: number;
  price: number;
  lastTradeUnixTime: number;
  holder?: number;
}

interface BirdeyeTokenSecurity {
  ownerAddress?: string;
  creatorAddress?: string;
  freezeAuthority?: string;
  mintAuthority?: string;
  ownerBalance?: number;
  ownerPercentage?: number;
  creatorBalance?: number;
  creatorPercentage?: number;
  top10HolderBalance?: number;
  top10HolderPercent?: number;
}

interface BirdeyePrice {
  value: number;
  updateUnixTime: number;
  updateHumanTime: string;
}

export class BirdeyeClient extends BaseAPIClient {
  constructor() {
    super('birdeye', {
      baseURL: 'https://public-api.birdeye.so',
      apiKey: config.apis.birdeyeApiKey,
      timeout: 15000,
      rateLimit: {
        maxRequests: 60, // Birdeye free tier
        windowMs: 60000, // 1 minute
      },
    });
  }

  async getTokenData(address: string): Promise<TokenData | null> {
    try {
      logger.debug(`Fetching Birdeye data for ${address}`);
      
      // Get token overview
      const overview = await this.get<{ data: BirdeyeTokenOverview }>(
        '/defi/token_overview',
        { params: { address } }
      );

      if (!overview.data) {
        logger.debug(`No Birdeye data found for ${address}`);
        return null;
      }

      const token = overview.data;

      const tokenData: TokenData = {
        address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        price: token.price || 0,
        marketCap: token.mc || 0,
        volume24h: token.v24hUSD || 0,
        liquidity: 0, // Need to fetch separately
        holders: token.holder || 0,
        priceChange24h: token.v24hChangePercent || 0,
        
        // Additional Birdeye specific data
        decimals: token.decimals,
        supply: token.supply,
        logoURI: token.logoURI,
        lastTradeTime: token.lastTradeUnixTime ? new Date(token.lastTradeUnixTime * 1000) : undefined,
      };

      logger.info(`Birdeye data fetched for ${tokenData.symbol}: ${tokenData.price}`);
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`Token ${address} not found on Birdeye`);
        return null;
      }
      logger.error(`Birdeye API error for ${address}:`, error.message);
      throw error;
    }
  }

  async getMarketData(address: string): Promise<MarketData | null> {
    try {
      // Get price history for high/low
      const priceHistory = await this.get<{ data: { items: BirdeyePrice[] } }>(
        '/defi/history_price',
        { 
          params: { 
            address,
            address_type: 'token',
            type: '1D', // Changed from '24h' to '1D'
          } 
        }
      );

      const tokenData = await this.getTokenData(address);
      if (!tokenData) return null;

      const prices = priceHistory.data?.items?.map(p => p.value) || [];
      const high24h = prices.length > 0 ? Math.max(...prices) : tokenData.price;
      const low24h = prices.length > 0 ? Math.min(...prices) : tokenData.price;

      return {
        price: tokenData.price,
        marketCap: tokenData.marketCap,
        volume24h: tokenData.volume24h,
        volume1h: 0, // Would need different endpoint
        priceChange24h: tokenData.priceChange24h || 0,
        priceChange1h: 0,
        high24h,
        low24h,
      };
    } catch (error) {
      logger.error('Error fetching Birdeye market data:', error);
      return null;
    }
  }

  async getHolderData(address: string): Promise<HolderData | null> {
    try {
      // Get token security info which includes holder data
      const security = await this.get<{ data: BirdeyeTokenSecurity }>(
        '/defi/token_security',
        { params: { address } }
      );

      if (!security.data) return null;

      const tokenData = await this.getTokenData(address);
      const totalHolders = tokenData?.holders || 0;

      return {
        totalHolders,
        top10Percentage: security.data.top10HolderPercent || 0,
        topHolders: [
          {
            address: security.data.ownerAddress || '',
            balance: security.data.ownerBalance || 0,
            percentage: security.data.ownerPercentage || 0,
            rank: 1,
            isCreator: false,
            isOwner: true,
          },
          {
            address: security.data.creatorAddress || '',
            balance: security.data.creatorBalance || 0,
            percentage: security.data.creatorPercentage || 0,
            rank: 2,
            isCreator: true,
            isOwner: false,
          },
        ].filter(h => h.address !== ''),
        concentration: this.calculateConcentration(security.data.top10HolderPercent || 0),
      };
    } catch (error) {
      logger.error('Error fetching Birdeye holder data:', error);
      return null;
    }
  }

  async getSecurityData(address: string): Promise<SecurityData | null> {
    try {
      const security = await this.get<{ data: BirdeyeTokenSecurity }>(
        '/defi/token_security',
        { params: { address } }
      );

      if (!security.data) return null;

      const hasMintAuth = !!security.data.mintAuthority && 
                          security.data.mintAuthority !== '11111111111111111111111111111111';
      const hasFreezeAuth = !!security.data.freezeAuthority && 
                            security.data.freezeAuthority !== '11111111111111111111111111111111';

      return {
        rugPullRisk: this.calculateRugPullRisk(security.data),
        honeypotRisk: false, // Birdeye doesn't provide this directly
        mintable: hasMintAuth,
        freezable: hasFreezeAuth,
        lpBurned: null, // Not provided by Birdeye
        topHolderConcentration: security.data.top10HolderPercent || 0,
        isVerified: false, // Would need different endpoint
        hasWebsite: false,
        hasSocials: false,
        contractVerified: false,
        
        // Additional security context
        ownerAddress: security.data.ownerAddress,
        creatorAddress: security.data.creatorAddress,
        mintAuthority: security.data.mintAuthority,
        freezeAuthority: security.data.freezeAuthority,
      };
    } catch (error) {
      logger.error('Error fetching Birdeye security data:', error);
      return null;
    }
  }

  async getLiquidityData(address: string): Promise<LiquidityData | null> {
    try {
      // Get pool info
      const pools = await this.get<{ data: { pools: any[] } }>(
        '/defi/token_pools',
        { params: { address } }
      );

      if (!pools.data?.pools || pools.data.pools.length === 0) {
        return null;
      }

      const sortedPools = pools.data.pools.sort((a, b) => 
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );

      const totalLiquidity = sortedPools.reduce((sum, pool) => 
        sum + (pool.liquidity?.usd || 0), 0
      );

      const mainPool = sortedPools[0];

      return {
        totalLiquidityUSD: totalLiquidity,
        poolCount: sortedPools.length,
        mainPool: {
          address: mainPool.address,
          dex: mainPool.source || 'unknown',
          liquidityUSD: mainPool.liquidity?.usd || 0,
          volume24h: mainPool.volume?.h24 || 0,
        },
        pools: sortedPools.slice(0, 5).map(pool => ({
          address: pool.address,
          dex: pool.source,
          liquidityUSD: pool.liquidity?.usd || 0,
          volume24h: pool.volume?.h24 || 0,
        })),
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`No liquidity data found for ${address} on Birdeye`);
        return null;
      }
      logger.error('Error fetching Birdeye liquidity data:', error);
      return null;
    }
  }

  private calculateConcentration(top10Percent: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (top10Percent < 30) return 'low';
    if (top10Percent < 50) return 'medium';
    if (top10Percent < 80) return 'high';
    return 'extreme';
  }

  private calculateRugPullRisk(security: BirdeyeTokenSecurity): number {
    let risk = 0;

    // High owner/creator balance
    if ((security.ownerPercentage || 0) > 20) risk += 0.3;
    if ((security.creatorPercentage || 0) > 20) risk += 0.3;
    
    // Mint authority not revoked
    if (security.mintAuthority && security.mintAuthority !== '11111111111111111111111111111111') {
      risk += 0.2;
    }
    
    // Freeze authority not revoked
    if (security.freezeAuthority && security.freezeAuthority !== '11111111111111111111111111111111') {
      risk += 0.1;
    }
    
    // High concentration
    if ((security.top10HolderPercent || 0) > 80) risk += 0.1;

    return Math.min(risk, 1);
  }
}