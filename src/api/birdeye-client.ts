// src/api/birdeye-client.ts
import { BaseAPIClient } from './base-api-client';
import { logger } from '../utils/logger';
import axios, { AxiosInstance } from 'axios';

export interface BirdeyeTokenData {
  address: string;
  price: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  holders: number;
  trades24h: number;
  uniqueWallets24h: number;
}

export class BirdeyeClient extends BaseAPIClient {
  private birdeyeClient: AxiosInstance;

  constructor(apiKey: string) {
    super('birdeye', 'https://public-api.birdeye.so', apiKey);
    
    // Create a custom axios instance with correct headers for Birdeye
    this.birdeyeClient = axios.create({
      baseURL: 'https://public-api.birdeye.so',
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': apiKey  // Birdeye uses X-API-KEY, not Authorization Bearer
      }
    });
  }

  async getTokenOverview(tokenAddress: string): Promise<BirdeyeTokenData> {
    try {
      // Use our custom client with correct headers
      const response = await this.birdeyeClient.get('/defi/token_overview', {
        params: { address: tokenAddress }
      });

      // Log the raw response to debug field names
      logger.debug(`[Birdeye] Raw response for ${tokenAddress}:`, JSON.stringify(response.data).substring(0, 500));

      // Handle both possible response structures
      const data = response.data?.data || response.data || {};

      return {
        address: tokenAddress,
        price: data.price || data.current_price || 0,
        marketCap: data.mc || data.market_cap || data.marketCap || 0,
        volume24h: data.v24hUSD || data.volume_24h || data.volume24h || 0,
        priceChange24h: data.priceChange24h || data.price_change_24h || 0,
        liquidity: data.liquidity || data.liquidityUSD || data.liquidity_usd || 0,
        holders: data.holder || data.holders || data.holder_count || 0,
        trades24h: data.trade24h || data.trades_24h || 0,
        uniqueWallets24h: data.uniqueWallet24h || data.unique_wallets_24h || 0
      };
    } catch (error: any) {
      logger.error(`[Birdeye] Error getting token overview for ${tokenAddress}:`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      
      // Return default values on error instead of throwing
      return {
        address: tokenAddress,
        price: 0,
        marketCap: 0,
        volume24h: 0,
        priceChange24h: 0,
        liquidity: 0,
        holders: 0,
        trades24h: 0,
        uniqueWallets24h: 0
      };
    }
  }

  async getTokenHistory(tokenAddress: string, timeframe: '1H' | '1D' | '1W' = '1D'): Promise<any[]> {
    try {
      const response = await this.birdeyeClient.get('/defi/token_history', {
        params: { 
          address: tokenAddress,
          timeframe,
          limit: 100
        }
      });
      return response.data?.data || [];
    } catch (error) {
      logger.error(`[Birdeye] Error getting token history for ${tokenAddress}:`, error);
      return [];
    }
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      await this.birdeyeClient.get('/defi/health');
      return true;
    } catch {
      return false;
    }
  }
}
