import { BaseAPIClient } from './base-api-client';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
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
  priceUsd: number;
  volume24h: number;
  liquidity: number;
  fdv: number;
  priceChange24h: number;
}

export class DexScreenerClient extends BaseAPIClient {
  constructor() {
    super('dexscreener', 'https://api.dexscreener.com/latest', undefined);
  }

  async getTokenPairs(tokenAddress: string): Promise<DexScreenerPair[]> {
    const data = await this.makeRequest<{ pairs: DexScreenerPair[] }>(
      `/dex/tokens/${tokenAddress}`,
      { method: 'GET' },
      0 // Free API
    );

    return data.pairs || [];
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      // Test with a known token (SOL)
      const pairs = await this.getTokenPairs('So11111111111111111111111111111111111111112');
      return pairs.length > 0;
    } catch {
      return false;
    }
  }
}