// src/integrations/solsniffer-client.ts
import { BaseAPIClient } from './base-api-client';
import { SolSnifferResponse, APIError } from './types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class SolSnifferClient extends BaseAPIClient {
  constructor() {
    super(
      'SolSniffer',
      'https://solsniffer.com/api/v2',
      {
        maxRequests: 30, // 30 requests per minute
        windowMs: 60000,
        retryAfter: 60000,
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apis.solsnifferApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  async getTokenAnalysis(tokenAddress: string): Promise<SolSnifferResponse | null> {
    try {
      logger.debug(`Fetching SolSniffer analysis for ${tokenAddress}`);
      
      const response = await this.makeRequest<SolSnifferResponse>({
        method: 'GET',
        url: `/token/${tokenAddress}`,
      });

      // Validate response
      if (!response || typeof response.rugPullRisk !== 'number') {
        logger.warn(`Invalid SolSniffer response for ${tokenAddress}`);
        return null;
      }

      logger.info(`SolSniffer analysis retrieved for ${tokenAddress}`, {
        rugPullRisk: response.rugPullRisk,
        holders: response.holders,
        verified: response.verified,
      });

      return response;
    } catch (error: any) {
      logger.error(`SolSniffer API error for ${tokenAddress}:`, {
        message: error.message,
        status: error.response?.status,
      });

      // Return null to allow fallback to other APIs
      return null;
    }
  }

  async getMultipleTokens(tokenAddresses: string[]): Promise<Map<string, SolSnifferResponse>> {
    const results = new Map<string, SolSnifferResponse>();
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (address) => {
        const result = await this.getTokenAnalysis(address);
        if (result) {
          results.set(address, result);
        }
      });

      await Promise.all(batchPromises);
      
      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await this.delay(1000);
      }
    }

    return results;
  }

  calculateSecurityScore(data: SolSnifferResponse): number {
    // Calculate a normalized security score (0-1, where 1 is most secure)
    let score = 1.0;

    // Rug pull risk (0-100, lower is better)
    score -= (data.rugPullRisk / 100) * 0.3;

    // Authority checks
    if (data.mintAuthority !== null) score -= 0.15;
    if (data.freezeAuthority !== null) score -= 0.15;

    // Liquidity checks
    if (!data.liquidityLocked) score -= 0.1;
    if (!data.lpBurned) score -= 0.1;

    // Tax checks (high taxes are bad)
    if (data.buyTax > 10) score -= 0.1;
    if (data.sellTax > 10) score -= 0.1;

    // Holder concentration (if top holders own too much)
    if (data.topHolders && data.topHolders.length > 0) {
      const topHolderPercentage = data.topHolders
        .slice(0, 10)
        .reduce((sum, holder) => sum + holder.percentage, 0);
      
      if (topHolderPercentage > 50) score -= 0.2;
      else if (topHolderPercentage > 30) score -= 0.1;
    }

    // Verification bonus
    if (data.verified) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  async getTokenSecuritySummary(tokenAddress: string): Promise<{
    isSecure: boolean;
    score: number;
    risks: string[];
    details: SolSnifferResponse | null;
  }> {
    const data = await this.getTokenAnalysis(tokenAddress);
    
    if (!data) {
      return {
        isSecure: false,
        score: 0,
        risks: ['Unable to fetch security data'],
        details: null,
      };
    }

    const score = this.calculateSecurityScore(data);
    const risks: string[] = [];

    // Identify risks
    if (data.rugPullRisk > 50) risks.push('High rug pull risk');
    if (data.mintAuthority !== null) risks.push('Mint authority not revoked');
    if (data.freezeAuthority !== null) risks.push('Freeze authority not revoked');
    if (!data.liquidityLocked) risks.push('Liquidity not locked');
    if (!data.lpBurned) risks.push('LP tokens not burned');
    if (data.buyTax > 10) risks.push(`High buy tax: ${data.buyTax}%`);
    if (data.sellTax > 10) risks.push(`High sell tax: ${data.sellTax}%`);
    
    if (data.topHolders && data.topHolders.length > 0) {
      const topHolderPercentage = data.topHolders
        .slice(0, 10)
        .reduce((sum, holder) => sum + holder.percentage, 0);
      
      if (topHolderPercentage > 50) {
        risks.push(`Top 10 holders own ${topHolderPercentage.toFixed(1)}% of supply`);
      }
    }

    return {
      isSecure: score >= 0.6 && risks.length <= 2,
      score,
      risks,
      details: data,
    };
  }
}