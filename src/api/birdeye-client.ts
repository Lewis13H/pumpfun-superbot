// src/api/birdeye-client.ts
import { BaseAPIClient } from './base-api-client';

export interface BirdeyeTokenData {
  address: string;
  current_price: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  holders: number;
  trades24h: number;
  uniqueWallets24h: number;
}

export class BirdeyeClient extends BaseAPIClient {
  constructor(apiKey: string) {
    super('birdeye', 'https://public-api.birdeye.so', apiKey);
  }

  async getTokenOverview(tokenAddress: string): Promise<BirdeyeTokenData> {
    const data = await this.makeRequest<any>(
      `/v1/token/overview`,
      { 
        method: 'GET',
        params: { address: tokenAddress }
      },
      0.005 // Estimated $0.005 per call
    );

    return {
      address: tokenAddress,
      current_price: data.price || 0,
      marketCap: data.market_cap || 0,
      volume24h: data.volume_24h || 0,
      priceChange24h: data.price_change_24h || 0,
      liquidity: data.liquidity || 0,
      holders: data.holder_count || 0,
      trades24h: data.trades_24h || 0,
      uniqueWallets24h: data.unique_wallets_24h || 0
    };
  }

  async getTokenHistory(tokenAddress: string, timeframe: '1H' | '1D' | '1W' = '1D'): Promise<any[]> {
    return await this.makeRequest<any[]>(
      `/v1/token/history`,
      {
        method: 'GET',
        params: { 
          address: tokenAddress,
          timeframe,
          limit: 100
        }
      },
      0.002 // Estimated $0.002 per call
    );
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      await this.makeRequest('/v1/health', { method: 'GET' }, 0);
      return true;
    } catch {
      return false;
    }
  }
}
