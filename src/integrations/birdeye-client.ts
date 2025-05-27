// src/integrations/birdeye-client.ts
import { BaseAPIClient } from './base-api-client';
import { BirdeyeTokenOverview, BirdeyeHolderInfo, TokenMetadata, TokenMarketData } from './types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class BirdeyeClient extends BaseAPIClient {
  constructor() {
    super(
      'Birdeye',
      'https://public-api.birdeye.so',
      {
        maxRequests: 50, // Birdeye allows 50 requests per minute
        windowMs: 60000,
        retryAfter: 60000,
      },
      {
        headers: {
          'X-API-KEY': config.apis.birdeyeApiKey,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  async getTokenOverview(tokenAddress: string): Promise<BirdeyeTokenOverview | null> {
    try {
      logger.debug(`Fetching Birdeye overview for ${tokenAddress}`);
      
      const response = await this.makeRequest<{ data: BirdeyeTokenOverview }>({
        method: 'GET',
        url: '/defi/token_overview',
        params: {
          address: tokenAddress,
        },
      });

      if (!response?.data) {
        logger.warn(`No Birdeye data found for ${tokenAddress}`);
        return null;
      }

      logger.info(`Birdeye overview retrieved for ${tokenAddress}`, {
        symbol: response.data.symbol,
        price: response.data.price,
        marketCap: response.data.marketCap,
      });

      return response.data;
    } catch (error: any) {
      logger.error(`Birdeye API error for ${tokenAddress}:`, {
        message: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async getTokenHolders(
    tokenAddress: string,
    limit: number = 100
  ): Promise<BirdeyeHolderInfo[]> {
    try {
      logger.debug(`Fetching Birdeye holders for ${tokenAddress}`);
      
      const response = await this.makeRequest<{
        data: {
          items: BirdeyeHolderInfo[];
          total: number;
        };
      }>({
        method: 'GET',
        url: '/defi/token_holder',
        params: {
          address: tokenAddress,
          limit,
          offset: 0,
        },
      });

      if (!response?.data?.items) {
        logger.warn(`No holder data found for ${tokenAddress}`);
        return [];
      }

      logger.info(`Retrieved ${response.data.items.length} holders for ${tokenAddress}`);
      return response.data.items;
    } catch (error: any) {
      logger.error(`Birdeye holders API error for ${tokenAddress}:`, {
        message: error.message,
        status: error.response?.status,
      });
      return [];
    }
  }

  async getTokenSecurity(tokenAddress: string): Promise<{
    freezeable: boolean;
    mintable: boolean;
    mutableMetadata: boolean;
    transferFeeEnable: boolean;
  } | null> {
    try {
      const response = await this.makeRequest<{
        data: {
          freezeable: boolean;
          mintable: boolean;
          mutableMetadata: boolean;
          transferFeeEnable: boolean;
        };
      }>({
        method: 'GET',
        url: '/defi/token_security',
        params: {
          address: tokenAddress,
        },
      });

      return response?.data || null;
    } catch (error: any) {
      logger.error(`Birdeye security API error for ${tokenAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  async getTokenPriceHistory(
    tokenAddress: string,
    timeframe: 'h' | 'd' | 'w' | 'm' = 'd',
    limit: number = 30
  ): Promise<Array<{ timestamp: number; value: number }> | null> {
    try {
      const response = await this.makeRequest<{
        data: {
          items: Array<{
            unixTime: number;
            value: number;
          }>;
        };
      }>({
        method: 'GET',
        url: '/defi/history_price',
        params: {
          address: tokenAddress,
          address_type: 'token',
          type: timeframe,
          limit,
        },
      });

      if (!response?.data?.items) return null;

      return response.data.items.map(item => ({
        timestamp: item.unixTime * 1000,
        value: item.value,
      }));
    } catch (error: any) {
      logger.error(`Birdeye price history error for ${tokenAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  async getTokenVolumeHistory(
    tokenAddress: string,
    timeframe: 'h' | 'd' | 'w' | 'm' = 'd',
    limit: number = 30
  ): Promise<Array<{ timestamp: number; value: number }> | null> {
    try {
      const response = await this.makeRequest<{
        data: {
          items: Array<{
            unixTime: number;
            value: number;
          }>;
        };
      }>({
        method: 'GET',
        url: '/defi/history_volume',
        params: {
          address: tokenAddress,
          address_type: 'token',
          type: timeframe,
          limit,
        },
      });

      if (!response?.data?.items) return null;

      return response.data.items.map(item => ({
        timestamp: item.unixTime * 1000,
        value: item.value,
      }));
    } catch (error: any) {
      logger.error(`Birdeye volume history error for ${tokenAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  // Helper method to convert Birdeye data to our standard format
  convertToTokenMetadata(data: BirdeyeTokenOverview): TokenMetadata {
    return {
      address: data.address,
      symbol: data.symbol,
      name: data.name,
      decimals: data.decimals,
      totalSupply: data.supply,
      image: data.logoURI,
    };
  }

  convertToMarketData(data: BirdeyeTokenOverview): TokenMarketData {
    return {
      price: {
        usd: data.price,
        change24h: data.priceChange24h,
      },
      marketCap: data.marketCap,
      volume24h: data.volume24h,
      liquidity: data.liquidity,
      holders: data.holder,
    };
  }

  // Get comprehensive token data
  async getComprehensiveTokenData(tokenAddress: string): Promise<{
    overview: BirdeyeTokenOverview | null;
    holders: BirdeyeHolderInfo[];
    security: any;
    metadata: TokenMetadata | null;
    marketData: TokenMarketData | null;
  }> {
    const [overview, holders, security] = await Promise.all([
      this.getTokenOverview(tokenAddress),
      this.getTokenHolders(tokenAddress),
      this.getTokenSecurity(tokenAddress),
    ]);

    return {
      overview,
      holders,
      security,
      metadata: overview ? this.convertToTokenMetadata(overview) : null,
      marketData: overview ? this.convertToMarketData(overview) : null,
    };
  }
}