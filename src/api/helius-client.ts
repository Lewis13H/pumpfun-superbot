import { BaseAPIClient } from './base-api-client';

export interface HeliusEnhancedData {
  address: string;
  transactionCount24h: number;
  avgTransactionSize: number;
  uniqueTraders24h: number;
  whaleActivity: number;
  suspiciousPatterns: string[];
  socialMetrics?: {
    mentions: number;
    sentiment: number;
  };
}

export class HeliusClient extends BaseAPIClient {
  constructor(rpcUrl: string) {
    super('helius', rpcUrl.replace('/rpc', ''), undefined);
  }

  async getEnhancedTokenData(tokenAddress: string): Promise<HeliusEnhancedData> {
    // Use Helius enhanced RPC methods
    const data = await this.makeRequest<any>(
      '/v0/token/enhanced-data',
      {
        method: 'POST',
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAnalytics',
          params: [tokenAddress, { timeframe: '24h' }]
        }
      },
      0.003 // Estimated cost within $99/month plan
    );

    return {
      address: tokenAddress,
      transactionCount24h: data.result?.transaction_count || 0,
      avgTransactionSize: data.result?.avg_transaction_size || 0,
      uniqueTraders24h: data.result?.unique_traders || 0,
      whaleActivity: data.result?.whale_activity || 0,
      suspiciousPatterns: data.result?.suspicious_patterns || [],
      socialMetrics: data.result?.social_metrics
    };
  }

  async getBasicTokenData(tokenAddress: string): Promise<Partial<HeliusEnhancedData>> {
    // Lighter version for basic analysis
    const data = await this.makeRequest<any>(
      '/v0/token/basic-data',
      {
        method: 'POST',
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenBasics',
          params: [tokenAddress]
        }
      },
      0.001 // Lower cost for basic data
    );

    return {
      address: tokenAddress,
      transactionCount24h: data.result?.transaction_count || 0,
      uniqueTraders24h: data.result?.unique_traders || 0
    };
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      await this.makeRequest('/', {
        method: 'POST',
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'getHealth'
        }
      }, 0);
      return true;
    } catch {
      return false;
    }
  }
}