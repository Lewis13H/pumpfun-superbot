import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TokenDiscovery } from '../discovery/base-monitor';

export interface TokenMetrics {
  price?: number;
  marketCap?: number;
  volume24h?: number;
  liquidity?: number;
  holders?: number;
  priceChange24h?: number;
  ageHours?: number;
}

export interface TokenAnalysis {
  tokenAddress: string;
  symbol: string;
  name: string;
  platform: string;
  metrics: TokenMetrics;
  scores: {
    liquidityScore: number;
    volumeScore: number;
    ageScore: number;
    overallScore: number;
  };
  analyzedAt: Date;
  status: 'success' | 'failed' | 'partial';
  errors?: string[];
}

export abstract class BaseAnalyzer extends EventEmitter {
  protected name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  abstract analyze(token: TokenDiscovery): Promise<TokenAnalysis>;

  protected calculateAge(createdAt: Date): number {
    const now = Date.now();
    const created = new Date(createdAt).getTime();
    return (now - created) / (1000 * 60 * 60); // hours
  }

  protected normalizeScore(value: number, min: number, max: number): number {
    if (value <= min) return 0;
    if (value >= max) return 1;
    return (value - min) / (max - min);
  }
}