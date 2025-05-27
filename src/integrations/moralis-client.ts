// src/integrations/moralis-client.ts
import { BaseAPIClient } from './base-api-client';
import { MoralisTokenPrice, MoralisTokenMetadata, MoralisTokenHolder } from './types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class MoralisClient extends BaseAPIClient {
  constructor() {
    super(
      'Moralis',
      'https://solana-gateway.moralis.io',
      {
        maxRequests: 25,
        windowMs: 60000,
        retryAfter: 60000,
      },
      {
        headers: {
          'X-API-Key': config.apis.moralisApiKey,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  async getTokenPrice(tokenAddress: string): Promise<MoralisTokenPrice | null> {
    try {
      logger.debug(`Fetching Moralis price for ${tokenAddress}`);
      
      const response = await this.makeRequest<MoralisTokenPrice>({
        method: 'GET',
        url: `/token/${tokenAddress}/price`,
        params: {
          network: 'mainnet',
        },
      });

      if (!response) {
        logger.warn(`No Moralis price data for ${tokenAddress}`);
        return null;
      }

      logger.info(`Moralis price retrieved for ${tokenAddress}`, {
        price: response.usdPrice,
        symbol: response.tokenSymbol,
      });

      return response;
    } catch (error: any) {
      logger.error(`Moralis price API error for ${tokenAddress}:`, {
        message: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async getTokenMetadata(tokenAddress: string): Promise<MoralisTokenMetadata | null> {
    try {
      logger.debug(`Fetching Moralis metadata for ${tokenAddress}`);
      
      const response = await this.makeRequest<MoralisTokenMetadata>({
        method: 'GET',
        url: `/token/${tokenAddress}/metadata`,
        params: {
          network: 'mainnet',
        },
      });

      if (!response) {
        logger.warn(`No Moralis metadata for ${tokenAddress}`);
        return null;
      }

      return response;
    } catch (error: any) {
      logger.error(`Moralis metadata API error for ${tokenAddress}:`, {
        message: error.message,
      });
      return null;
    }
  }

  async getTokenHolders(
    tokenAddress: string,
    limit: number = 100
  ): Promise<MoralisTokenHolder[]> {
    try {
      logger.debug(`Fetching Moralis holders for ${tokenAddress}`);
      
      const response = await this.makeRequest<{
        result: MoralisTokenHolder[];
        total: number;
      }>({
        method: 'GET',
        url: `/token/${tokenAddress}/owners`,
        params: {
          network: 'mainnet',
          limit,
          order: 'DESC',
        },
      });

      if (!response?.result) {
        logger.warn(`No Moralis holder data for ${tokenAddress}`);
        return [];
      }

      logger.info(`Retrieved ${response.result.length} holders from Moralis for ${tokenAddress}`);
      return response.result;
    } catch (error: any) {
      logger.error(`Moralis holders API error for ${tokenAddress}:`, {
        message: error.message,
      });
      return [];
    }
  }

  async getTokenTransfers(
    tokenAddress: string,
    limit: number = 100
  ): Promise<any[]> {
    try {
      const response = await this.makeRequest<{
        result: any[];
      }>({
        method: 'GET',
        url: `/token/${tokenAddress}/transfers`,
        params: {
          network: 'mainnet',
          limit,
          order: 'DESC',
        },
      });

      return response?.result || [];
    } catch (error: any) {
      logger.error(`Moralis transfers API error for ${tokenAddress}:`, {
        message: error.message,
      });
      return [];
    }
  }

  async getWalletTokens(walletAddress: string): Promise<any[]> {
    try {
      const response = await this.makeRequest<{
        result: any[];
      }>({
        method: 'GET',
        url: `/account/${walletAddress}/tokens`,
        params: {
          network: 'mainnet',
        },
      });

      return response?.result || [];
    } catch (error: any) {
      logger.error(`Moralis wallet tokens API error for ${walletAddress}:`, {
        message: error.message,
      });
      return [];
    }
  }

  // Analyze token distribution
  analyzeTokenDistribution(holders: MoralisTokenHolder[]): {
    giniCoefficient: number;
    top10Percentage: number;
    uniqueHolders: number;
    concentrationRisk: 'low' | 'medium' | 'high';
  } {
    if (holders.length === 0) {
      return {
        giniCoefficient: 0,
        top10Percentage: 0,
        uniqueHolders: 0,
        concentrationRisk: 'high',
      };
    }

    // Calculate total supply from holders
    const totalSupply = holders.reduce((sum, holder) => {
      return sum + parseFloat(holder.balance);
    }, 0);

    // Calculate top 10 percentage
    const top10 = holders.slice(0, 10);
    const top10Supply = top10.reduce((sum, holder) => {
      return sum + parseFloat(holder.balance);
    }, 0);
    const top10Percentage = (top10Supply / totalSupply) * 100;

    // Calculate Gini coefficient
    const gini = this.calculateGiniCoefficient(holders.map(h => 
      parseFloat(h.balance) / totalSupply
    ));

    // Determine concentration risk
    let concentrationRisk: 'low' | 'medium' | 'high';
    if (top10Percentage > 50 || gini > 0.8) {
      concentrationRisk = 'high';
    } else if (top10Percentage > 30 || gini > 0.6) {
      concentrationRisk = 'medium';
    } else {
      concentrationRisk = 'low';
    }

    return {
      giniCoefficient: gini,
      top10Percentage,
      uniqueHolders: holders.length,
      concentrationRisk,
    };
  }

  private calculateGiniCoefficient(values: number[]): number {
    if (values.length === 0) return 0;
    
    // Sort values
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    
    // Calculate Gini coefficient
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (2 * (i + 1) - n - 1) * sorted[i];
    }
    
    const totalWealth = sorted.reduce((a, b) => a + b, 0);
    if (totalWealth === 0) return 0;
    
    return sum / (n * totalWealth);
  }

  // Check if address is a smart contract
  async isSmartContract(address: string): Promise<boolean> {
    try {
      const response = await this.makeRequest<{
        is_contract: boolean;
      }>({
        method: 'GET',
        url: `/account/${address}/is-contract`,
        params: {
          network: 'mainnet',
        },
      });

      return response?.is_contract || false;
    } catch (error) {
      logger.debug(`Failed to check if ${address} is contract`);
      return false;
    }
  }

  // Get comprehensive holder analysis
  async getHolderAnalysis(tokenAddress: string): Promise<{
    holders: MoralisTokenHolder[];
    distribution: any;
    suspiciousWallets: string[];
  }> {
    const holders = await this.getTokenHolders(tokenAddress);
    const distribution = this.analyzeTokenDistribution(holders);
    
    // Identify suspicious wallets
    const suspiciousWallets: string[] = [];
    
    for (const holder of holders.slice(0, 20)) {
      // Check if it's a contract
      const isContract = await this.isSmartContract(holder.address);
      
      // Flag contracts holding large amounts
      if (isContract && holder.percentage_relative_to_total_supply > 5) {
        suspiciousWallets.push(holder.address);
      }
      
      // Flag wallets with exactly round numbers (potential team wallets)
      const balance = parseFloat(holder.balance);
      if (balance % 1000000 === 0 && balance > 0) {
        suspiciousWallets.push(holder.address);
      }
    }

    return {
      holders,
      distribution,
      suspiciousWallets: [...new Set(suspiciousWallets)],
    };
  }
}