export interface TokenAnalysis {
  tokenAddress: string;
  symbol: string;
  name: string;
  analyzedAt: Date;
  
  // Market metrics
  price: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  holders: number;
  
  // Analysis scores (0-1)
  safetyScore: number;
  potentialScore: number;
  liquidityScore: number;
  communityScore: number;
  momentumScore: number;
  compositeScore: number;
  
  // Classification
  classification: InvestmentClassification;
  confidence: number;
}

export interface AnalysisResult extends TokenAnalysis {
  rawData: {
    token: any;
    market: any;
    holders: any;
    security: any;
    liquidity: any;
  };
}

export type InvestmentClassification = 
  | 'STRONG_BUY'
  | 'BUY'
  | 'CONSIDER'
  | 'MONITOR'
  | 'HIGH_RISK'
  | 'AVOID';

export interface AnalysisMetrics {
  safety: number;
  liquidity: number;
  community: number;
  momentum: number;
  potential: number;
  composite: number;
  confidence: number;
}

export interface AnalysisConfig {
  weights: {
    safety: number;
    liquidity: number;
    community: number;
    momentum: number;
    potential: number;
  };
  thresholds: {
    strongBuy: number;
    buy: number;
    consider: number;
    monitor: number;
    avoid: number;
  };
}

export interface AnalysisHistoryEntry {
  id: number;
  tokenAddress: string;
  analyzedAt: Date;
  compositeScore: number;
  classification: InvestmentClassification;
  metrics: AnalysisMetrics;
}