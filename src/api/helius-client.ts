import { BaseAPIClient } from './base-api-client';
import { logger } from '../utils/logger';
import axios from 'axios';

export interface TokenHolder {
  address: string;
  amount: number;
  decimals: number;
  owner: string;
}

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
  private rpcUrl: string;
  
  constructor(rpcUrl: string) {
    const baseUrl = rpcUrl.includes('?api-key=') 
      ? rpcUrl.split('?api-key=')[0]
      : rpcUrl;
    const apiKey = rpcUrl.includes('?api-key=') 
      ? rpcUrl.split('?api-key=')[1]
      : undefined;
    
    super('helius', baseUrl, apiKey);
    this.rpcUrl = rpcUrl;
  }

  async getTokenHolders(tokenAddress: string, limit: number = 10): Promise<TokenHolder[]> {
    try {
      // Use Helius's token holder endpoint
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'get-token-holders',
        method: 'getTokenLargestAccounts',
        params: [tokenAddress]
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      const holders = response.data.result?.value || [];
      
      // Get the top holders
      return holders.slice(0, limit).map((holder: any) => ({
        address: tokenAddress,
        amount: holder.amount || holder.uiAmount || 0,
        decimals: holder.decimals || 6,
        owner: holder.address || holder.owner || ''
      }));
    } catch (error) {
      logger.error(`[Helius] Error getting token holders for ${tokenAddress}:`, error);
      return [];
    }
  }

  async getTokenSupply(tokenAddress: string): Promise<number> {
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'get-token-supply',
        method: 'getTokenSupply',
        params: [tokenAddress]
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result?.value?.uiAmount || 0;
    } catch (error) {
      logger.error(`[Helius] Error getting token supply for ${tokenAddress}:`, error);
      return 0;
    }
  }

  async getTokenAccountBalance(tokenAccount: string): Promise<number> {
    try {
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'get-balance',
        method: 'getTokenAccountBalance',
        params: [tokenAccount]
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result?.value?.uiAmount || 0;
    } catch (error) {
      logger.error(`[Helius] Error getting token balance:`, error);
      return 0;
    }
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
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'health-check',
        method: 'getHealth'
      });
      return !response.data.error;
    } catch {
      return false;
    }
  }
}