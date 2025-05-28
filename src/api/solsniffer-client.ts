// src/api/solsniffer-client.ts
import { BaseAPIClient } from './base-api-client';

export interface SolSnifferTokenAnalysis {
  address: string;
  rugPullRisk: number; // 0-1 score
  liquidityLocked: boolean;
  lpBurned: boolean;
  mintAuthorityRenounced: boolean;
  topHolderPercentage: number;
  suspiciousActivity: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings: string[];
}

export class SolSnifferClient extends BaseAPIClient {
  constructor(apiKey: string) {
    super('solsniffer', 'https://api.solsniffer.com/v1', apiKey);
  }

  async analyzeToken(tokenAddress: string): Promise<SolSnifferTokenAnalysis> {
    const data = await this.makeRequest<any>(
      `/token/${tokenAddress}/analysis`,
      { method: 'GET' },
      0.01 // Estimated $0.01 per call
    );

    return {
      address: tokenAddress,
      rugPullRisk: data.rug_risk_score || 0,
      liquidityLocked: data.liquidity_locked || false,
      lpBurned: data.lp_burned || false,
      mintAuthorityRenounced: !data.mint_authority_enabled,
      topHolderPercentage: data.top_holder_percentage || 0,
      suspiciousActivity: data.suspicious_activity || false,
      riskLevel: this.calculateRiskLevel(data.rug_risk_score || 0),
      warnings: data.warnings || []
    };
  }

  private calculateRiskLevel(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (riskScore >= 0.8) return 'CRITICAL';
    if (riskScore >= 0.6) return 'HIGH';
    if (riskScore >= 0.4) return 'MEDIUM';
    return 'LOW';
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      await this.makeRequest('/health', { method: 'GET' }, 0);
      return true;
    } catch {
      return false;
    }
  }
}