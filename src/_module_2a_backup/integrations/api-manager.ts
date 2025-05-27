import { 
  TokenData, 
  MarketData, 
  HolderData, 
  SecurityData, 
  LiquidityData,
  APIClientStatus 
} from './types';
import { DexScreenerClient } from './dexscreener-client';
import { BirdeyeClient } from './birdeye-client';
import { logger } from '../utils/logger';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class APIManager {
  private clients: Map<string, any> = new Map();
  private cache: Map<string, CacheEntry<any>> = new Map();
  private initialized: boolean = false;

  constructor() {
    // Initialize clients
    this.clients.set('dexscreener', new DexScreenerClient());
    this.clients.set('birdeye', new BirdeyeClient());
    
    // TODO: Add these when implemented
    // this.clients.set('solsniffer', new SolSnifferClient());
    // this.clients.set('helius', new HeliusClient());
    // this.clients.set('moralis', new MoralisClient());

    this.initialized = true;
    logger.info('API Manager initialized with DexScreener and Birdeye clients');
  }

  private getCacheKey(type: string, address: string): string {
    return `${type}:${address.toLowerCase()}`;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit for ${key}`);
    return entry.data;
  }

  private setCache<T>(key: string, data: T, ttl: number = 60000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  async getTokenData(address: string): Promise<TokenData | null> {
    const cacheKey = this.getCacheKey('token', address);
    const cached = this.getFromCache<TokenData>(cacheKey);
    if (cached) return cached;

    const errors: string[] = [];

    // Try Birdeye first (more comprehensive data)
    try {
      const birdeyeClient = this.clients.get('birdeye');
      if (birdeyeClient) {
        const data = await birdeyeClient.getTokenData(address);
        if (data) {
          this.setCache(cacheKey, data, 120000); // 2 minute cache
          return data;
        }
      }
    } catch (error: any) {
      errors.push(`Birdeye: ${error.message}`);
      logger.debug('Birdeye failed, trying DexScreener...');
    }

    // Fallback to DexScreener
    try {
      const dexClient = this.clients.get('dexscreener');
      if (dexClient) {
        const data = await dexClient.getTokenData(address);
        if (data) {
          this.setCache(cacheKey, data, 120000);
          return data;
        }
      }
    } catch (error: any) {
      errors.push(`DexScreener: ${error.message}`);
    }

    if (errors.length > 0) {
      logger.error(`All APIs failed for token ${address}:`, errors);
    }

    return null;
  }

  async getMarketData(address: string): Promise<MarketData | null> {
    const cacheKey = this.getCacheKey('market', address);
    const cached = this.getFromCache<MarketData>(cacheKey);
    if (cached) return cached;

    // Try Birdeye first
    try {
      const birdeyeClient = this.clients.get('birdeye');
      if (birdeyeClient) {
        const data = await birdeyeClient.getMarketData(address);
        if (data) {
          this.setCache(cacheKey, data, 30000); // 30 second cache for market data
          return data;
        }
      }
    } catch (error) {
      logger.debug('Birdeye market data failed, trying DexScreener...');
    }

    // Fallback to DexScreener
    try {
      const dexClient = this.clients.get('dexscreener');
      if (dexClient) {
        const data = await dexClient.getMarketData(address);
        if (data) {
          this.setCache(cacheKey, data, 30000);
          return data;
        }
      }
    } catch (error) {
      logger.error('All APIs failed for market data:', error);
    }

    return null;
  }

  async getHolderData(address: string): Promise<HolderData | null> {
    const cacheKey = this.getCacheKey('holders', address);
    const cached = this.getFromCache<HolderData>(cacheKey);
    if (cached) return cached;

    // Only Birdeye provides holder data currently
    try {
      const birdeyeClient = this.clients.get('birdeye');
      if (birdeyeClient) {
        const data = await birdeyeClient.getHolderData(address);
        if (data) {
          this.setCache(cacheKey, data, 300000); // 5 minute cache
          return data;
        }
      }
    } catch (error) {
      logger.error('Failed to get holder data:', error);
    }

    // TODO: Add Helius/Moralis as fallback when implemented
    return null;
  }

  async getSecurityData(address: string): Promise<SecurityData | null> {
    const cacheKey = this.getCacheKey('security', address);
    const cached = this.getFromCache<SecurityData>(cacheKey);
    if (cached) return cached;

    // Aggregate security data from multiple sources
    const securityData: Partial<SecurityData> = {};
    
    // Get Birdeye security data
    try {
      const birdeyeClient = this.clients.get('birdeye');
      if (birdeyeClient) {
        const data = await birdeyeClient.getSecurityData(address);
        if (data) {
          Object.assign(securityData, data);
        }
      }
    } catch (error) {
      logger.debug('Birdeye security data failed');
    }

    // Get DexScreener data (limited security info)
    try {
      const dexClient = this.clients.get('dexscreener');
      if (dexClient) {
        const data = await dexClient.getSecurityData(address);
        if (data) {
          // Merge without overwriting existing data
          if (securityData.honeypotRisk === undefined) {
            securityData.honeypotRisk = data.honeypotRisk;
          }
        }
      }
    } catch (error) {
      logger.debug('DexScreener security data failed');
    }

    // TODO: Add SolSniffer when implemented (best security data)

    if (Object.keys(securityData).length > 0) {
      const fullData = securityData as SecurityData;
      this.setCache(cacheKey, fullData, 600000); // 10 minute cache
      return fullData;
    }

    return null;
  }

  async getLiquidityData(address: string): Promise<LiquidityData | null> {
    const cacheKey = this.getCacheKey('liquidity', address);
    const cached = this.getFromCache<LiquidityData>(cacheKey);
    if (cached) return cached;

    // Try Birdeye first (more detailed)
    try {
      const birdeyeClient = this.clients.get('birdeye');
      if (birdeyeClient) {
        const data = await birdeyeClient.getLiquidityData(address);
        if (data) {
          this.setCache(cacheKey, data, 60000); // 1 minute cache
          return data;
        }
      }
    } catch (error) {
      logger.debug('Birdeye liquidity data failed, trying DexScreener...');
    }

    // Fallback to DexScreener
    try {
      const dexClient = this.clients.get('dexscreener');
      if (dexClient) {
        const data = await dexClient.getLiquidityData(address);
        if (data) {
          this.setCache(cacheKey, data, 60000);
          return data;
        }
      }
    } catch (error) {
      logger.error('All APIs failed for liquidity data:', error);
    }

    return null;
  }

  getStatus(): APIClientStatus[] {
    const statuses: APIClientStatus[] = [];

    for (const [name, client] of this.clients) {
      if (client && typeof client.getStats === 'function') {
        const stats = client.getStats();
        statuses.push({
          name,
          status: 'active',
          requestsInWindow: stats.requestsInWindow,
          rateLimitRemaining: stats.maxRequests - stats.requestsInWindow,
        });
      } else {
        statuses.push({
          name,
          status: 'not-implemented',
          requestsInWindow: 0,
          rateLimitRemaining: 0,
        });
      }
    }

    // Add cache stats
    statuses.push({
      name: 'cache',
      status: 'active',
      requestsInWindow: this.cache.size,
      rateLimitRemaining: 10000 - this.cache.size, // Arbitrary max cache size
    });

    return statuses;
  }

  clearCache(): void {
    const oldSize = this.cache.size;
    this.cache.clear();
    logger.info(`Cleared API cache (${oldSize} entries)`);
  }

  // Utility method for batch fetching
  async getBatchTokenData(addresses: string[]): Promise<Map<string, TokenData>> {
    const results = new Map<string, TokenData>();
    
    // Check cache first
    const uncached: string[] = [];
    for (const address of addresses) {
      const cacheKey = this.getCacheKey('token', address);
      const cached = this.getFromCache<TokenData>(cacheKey);
      if (cached) {
        results.set(address, cached);
      } else {
        uncached.push(address);
      }
    }

    if (uncached.length === 0) return results;

    // Try batch fetch from DexScreener (supports batch)
    try {
      const dexClient = this.clients.get('dexscreener') as DexScreenerClient;
      if (dexClient && dexClient.getMultipleTokens) {
        const batchResults = await dexClient.getMultipleTokens(uncached);
        for (const [address, data] of batchResults) {
          results.set(address, data);
          const cacheKey = this.getCacheKey('token', address);
          this.setCache(cacheKey, data, 120000);
        }
      }
    } catch (error) {
      logger.error('Batch fetch failed:', error);
    }

    // Fallback to individual fetches for missing tokens
    const missing = uncached.filter(addr => !results.has(addr));
    for (const address of missing) {
      const data = await this.getTokenData(address);
      if (data) {
        results.set(address, data);
      }
    }

    return results;
  }
}

// Export singleton instance
export const apiManager = new APIManager();