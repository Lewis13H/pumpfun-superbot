// src/api/solsniffer-client.ts
import { BaseAPIClient } from './base-api-client';
import { logger } from '../utils/logger';

export interface SolSnifferTokenAnalysis {
  address: string;
  score: number; // 0-100 safety score (100 is safest)
  rugPullRisk: number; // 0-100 risk score (0 is safest)
  liquidityLocked: boolean;
  lpBurned: boolean;
  mintAuthorityRenounced: boolean;
  topHolderPercentage: number;
  suspiciousActivity: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings: string[];
  honeypot?: boolean;
  freezeAuthorityRenounced?: boolean;
  // Additional fields for complete data storage
  highRiskCount?: number;
  mediumRiskCount?: number;
  lowRiskCount?: number;
  specificRisks?: Record<string, any>;
  rawIndicatorData?: any;
  tokenInfo?: any;
}

export class SolSnifferClient extends BaseAPIClient {
  constructor(apiKey: string) {
    super('solsniffer', 'https://solsniffer.com/api/v2', apiKey);
    
    // Set API key in header as per SolSniffer docs
    this.client.defaults.headers.common['X-API-Key'] = apiKey;
  }

  async analyzeToken(tokenAddress: string): Promise<SolSnifferTokenAnalysis> {
    try {
      logger.info(`[SOLSNIFFER] Analyzing token ${tokenAddress}`);
      
      const startTime = Date.now();
      
      // According to SolSniffer docs, the endpoint is /token/{address}
      const data = await this.makeRequest<any>(
        `/token/${tokenAddress}`,
        { 
          method: 'GET',
          headers: {
            'X-API-Key': this.apiKey
          }
        },
        0.01 // $0.01 per call
      );
      
      const responseTime = Date.now() - startTime;
      logger.info(`[SOLSNIFFER] Response received in ${responseTime}ms`, {
        tokenAddress,
        responseKeys: Object.keys(data),
        hasTokenData: !!data.tokenData,
        hasTokenInfo: !!data.tokenInfo,
        hasScore: !!(data.score || data.tokenData?.score || data.tokenInfo?.score)
      });

      return this.parseResponse(data, tokenAddress);
    } catch (error) {
      logger.error(`[SOLSNIFFER] Error analyzing token ${tokenAddress}:`, error);
      throw error;
    }
  }

  private parseResponse(data: any, tokenAddress: string): SolSnifferTokenAnalysis {
    logger.info(`[SOLSNIFFER] Parsing response for ${tokenAddress}`, {
      dataStructure: {
        hasTokenData: !!data.tokenData,
        hasTokenInfo: !!data.tokenInfo,
        tokenDataKeys: data.tokenData ? Object.keys(data.tokenData) : [],
        tokenInfoKeys: data.tokenInfo ? Object.keys(data.tokenInfo) : []
      }
    });
    
    // Extract score - check multiple possible locations
    let score = 0;
    
    // Check for score in main response
    if (data.score !== undefined) {
      score = Number(data.score);
      logger.info(`[SOLSNIFFER] Found score in main response: ${score}`);
    } 
    // Check in tokenData
    else if (data.tokenData?.score !== undefined) {
      score = Number(data.tokenData.score);
      logger.info(`[SOLSNIFFER] Found score in tokenData: ${score}`);
    } 
    // Check in tokenInfo
    else if (data.tokenInfo?.score !== undefined) {
      score = Number(data.tokenInfo.score);
      logger.info(`[SOLSNIFFER] Found score in tokenInfo: ${score}`);
    }
    // Check if there's a safetyScore field
    else if (data.tokenData?.safetyScore !== undefined) {
      score = Number(data.tokenData.safetyScore);
      logger.info(`[SOLSNIFFER] Found safetyScore in tokenData: ${score}`);
    }
    
    // Parse indicator data
    const warnings: string[] = [];
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    let specificRisks: Record<string, any> = {};
    
    if (data.tokenData?.indicatorData) {
      const indicators = data.tokenData.indicatorData;
      
      // Count risk indicators
      highRiskCount = indicators.high?.count || 0;
      mediumRiskCount = indicators.moderate?.count || indicators.medium?.count || 0;
      lowRiskCount = indicators.low?.count || 0;
      
      // Extract specific risks
      if (indicators.specific) {
        specificRisks = indicators.specific;
      }
      
      // Add warnings for high risks
      if (highRiskCount > 0) {
        warnings.push(`${highRiskCount} high risk indicators found`);
        
        // Parse high risk details
        if (indicators.high?.details) {
          try {
            const details = typeof indicators.high.details === 'string' 
              ? JSON.parse(indicators.high.details) 
              : indicators.high.details;
              
            Object.entries(details).forEach(([key, value]) => {
              if (value) {
                warnings.push(key);
                specificRisks[key] = value;
              }
            });
          } catch (e) {
            logger.debug('[SOLSNIFFER] Could not parse high risk details');
          }
        }
      }
      
      if (mediumRiskCount > 0) {
        warnings.push(`${mediumRiskCount} medium risk indicators found`);
      }
      
      if (lowRiskCount > 0) {
        warnings.push(`${lowRiskCount} low risk indicators found`);
      }
      
      // If no score was found, calculate from indicators
      if (score === 0) {
        // Based on your logs, it seems the score might be calculated as:
        // 100 - (high * 10) - (medium * 5) - (low * 5)
        // But let's use a more conservative calculation
        score = 100;
        score -= highRiskCount * 20;  // High risks have more impact
        score -= mediumRiskCount * 10;
        score -= lowRiskCount * 5;
        score = Math.max(0, Math.min(100, score));
        
        logger.warn(`[SOLSNIFFER] No score found in response, calculated from indicators: ${score}`);
      }
    }
    
    // Extract token info with all available fields
    const tokenInfo = data.tokenInfo || {};
    
    // Convert safety score to risk score for backward compatibility
    const rugPullRisk = 100 - score;
    
    // Determine risk level based on safety score
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (score >= 80) riskLevel = 'LOW';
    else if (score >= 60) riskLevel = 'MEDIUM';
    else if (score >= 40) riskLevel = 'HIGH';
    else riskLevel = 'CRITICAL';
    
    const result: SolSnifferTokenAnalysis = {
      address: tokenAddress,
      score: score, // 0-100 safety score (100 is safest)
      rugPullRisk: rugPullRisk, // 0-100 risk score (0 is safest)
      liquidityLocked: tokenInfo.liquidityLocked || false,
      lpBurned: tokenInfo.lpBurned || false,
      mintAuthorityRenounced: tokenInfo.mintAuthorityRenounced || tokenInfo.mintDisabled || !tokenInfo.mintable || false,
      freezeAuthorityRenounced: tokenInfo.freezeAuthorityRenounced || tokenInfo.freezeDisabled || !tokenInfo.freezable || false,
      topHolderPercentage: tokenInfo.topHolderPercent || tokenInfo.topHolderPercentage || tokenInfo.top10Percent || 0,
      suspiciousActivity: score < 50,
      honeypot: tokenInfo.isHoneypot || tokenInfo.honeypot || false,
      riskLevel: riskLevel,
      warnings: warnings,
      highRiskCount: highRiskCount,
      mediumRiskCount: mediumRiskCount,
      lowRiskCount: lowRiskCount,
      specificRisks: specificRisks,
      rawIndicatorData: data.tokenData?.indicatorData,
      tokenInfo: tokenInfo
    };
    
    logger.info(`[SOLSNIFFER] Analysis complete for ${tokenAddress}`, {
      score: result.score,
      rugPullRisk: result.rugPullRisk,
      riskLevel: result.riskLevel,
      warningCount: warnings.length,
      risks: {
        high: highRiskCount,
        medium: mediumRiskCount,
        low: lowRiskCount
      }
    });
    
    return result;
  }

  async getServiceStatus(): Promise<boolean> {
    try {
      // Use wrapped SOL address for status check
      await this.makeRequest('/token/So11111111111111111111111111111111111111112', { method: 'GET' }, 0);
      return true;
    } catch {
      return false;
    }
  }

  // Helper method to get the score directly
  async getTokenScore(tokenAddress: string): Promise<number> {
    const analysis = await this.analyzeToken(tokenAddress);
    return analysis.score;
  }
}