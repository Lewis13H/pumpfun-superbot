// src/analysis/basic-analyzer.ts
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AddressValidator } from '../utils/address-validator';

export interface BasicAnalysis {
  address: string;
  symbol: string;
  name: string;
  marketCap: number;
  price: number;
  volume24h: number;
  liquidity: number;
  holders: {
    count: number;
    top10Percentage?: number;
  };
  security: {
    rugPullRisk: string;
    liquidityLocked: boolean;
  };
}

export class BasicAnalyzer {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.apis.heliusRpcUrl);
  }

  async analyze(tokenAddress: string): Promise<BasicAnalysis> {
    // Validate address first
    if (!AddressValidator.isValidAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }

    logger.debug(`Starting basic analysis for ${tokenAddress}`);

    // Get token info from database first
    const { db } = await import('../database/postgres');
    const tokenInfo = await db('tokens')
      .where('address', tokenAddress)
      .first();

    if (!tokenInfo) {
      throw new Error(`Token not found in database: ${tokenAddress}`);
    }

    // Perform parallel data fetching
    const [onChainData, marketData] = await Promise.allSettled([
      this.getOnChainData(tokenAddress),
      this.getMarketData(tokenAddress),
    ]);

    // Combine results
    const analysis: BasicAnalysis = {
      address: tokenAddress,
      symbol: tokenInfo.symbol || 'UNKNOWN',
      name: tokenInfo.name || 'Unknown Token',
      marketCap: 0,
      price: 0,
      volume24h: 0,
      liquidity: 0,
      holders: {
        count: 0,
      },
      security: {
        rugPullRisk: 'UNKNOWN',
        liquidityLocked: false,
      },
    };

    // Process on-chain data
    if (onChainData.status === 'fulfilled' && onChainData.value) {
      Object.assign(analysis, onChainData.value);
    }

    // Process market data
    if (marketData.status === 'fulfilled' && marketData.value) {
      Object.assign(analysis, marketData.value);
    }

    // If we have metadata from discovery, use it as fallback
    if (tokenInfo.raw_data) {
      try {
        const metadata = JSON.parse(tokenInfo.raw_data);
        if (metadata.marketCap && !analysis.marketCap) {
          analysis.marketCap = metadata.marketCap;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    return analysis;
  }

  private async getOnChainData(tokenAddress: string): Promise<Partial<BasicAnalysis>> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      
      // Get token supply
      const supply = await this.connection.getTokenSupply(mintPubkey);
      
      // Get largest accounts (rough holder count)
      const largestAccounts = await this.connection.getTokenLargestAccounts(mintPubkey);
      
      return {
        holders: {
          count: largestAccounts.value.length,
        },
      };
    } catch (error) {
      logger.error(`Failed to get on-chain data for ${tokenAddress}:`, error);
      return {};
    }
  }

  private async getMarketData(tokenAddress: string): Promise<Partial<BasicAnalysis>> {
    try {
      // Try DexScreener API (no auth required)
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );

      if (response.data && response.data.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0]; // Use first pair
        
        return {
          price: parseFloat(pair.priceUsd || '0'),
          marketCap: parseFloat(pair.fdv || '0'),
          volume24h: parseFloat(pair.volume?.h24 || '0'),
          liquidity: parseFloat(pair.liquidity?.usd || '0'),
        };
      }
    } catch (error) {
      logger.debug(`DexScreener API failed for ${tokenAddress}, trying alternatives`);
    }

    // Return empty data if all APIs fail
    return {};
  }

  async batchAnalyze(tokenAddresses: string[]): Promise<Map<string, BasicAnalysis>> {
    const results = new Map<string, BasicAnalysis>();
    
    // Validate all addresses first
    const validAddresses = tokenAddresses.filter(addr => {
      if (!AddressValidator.isValidAddress(addr)) {
        logger.warn(`Skipping invalid address in batch: ${addr}`);
        return false;
      }
      return true;
    });

    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < validAddresses.length; i += batchSize) {
      const batch = validAddresses.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(address => this.analyze(address))
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.set(batch[index], result.value);
        } else {
          logger.error(`Failed to analyze ${batch[index]}:`, result.reason);
        }
      });
    }

    return results;
  }
}