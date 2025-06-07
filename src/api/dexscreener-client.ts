// src/api/dexscreener-client.ts
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
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  // Optional fields (might not always be present)
  volume24h?: number; // Some pairs might have this legacy field
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: string[];
    socials?: Array<{ type: string; url: string }>;
  };
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
