import { BaseAnalyzer, TokenAnalysis, TokenMetrics } from './base-analyzer';
import { TokenDiscovery } from '../discovery/base-monitor';
import { MetricsFetcher } from './metrics-fetcher';
import { logger } from '../utils/logger';

export class SimpleTokenAnalyzer extends BaseAnalyzer {
  private metricsFetcher: MetricsFetcher;

  constructor() {
    super('SimpleAnalyzer');
    this.metricsFetcher = new MetricsFetcher();
  }

  async analyze(token: TokenDiscovery): Promise<TokenAnalysis> {
    const startTime = Date.now();
    const errors: string[] = [];
    
    logger.info(`Starting analysis for ${token.symbol} (${token.address})`);

    try {
      // Fetch metrics
      const metrics = await this.metricsFetcher.fetchMetrics(token.address);
      
      // Calculate age
      metrics.ageHours = this.calculateAge(token.createdAt);

      // Calculate scores
      const scores = this.calculateScores(metrics, token);

      // Determine status
      const status = this.determineStatus(metrics, errors);

      const analysis: TokenAnalysis = {
        tokenAddress: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        metrics,
        scores,
        analyzedAt: new Date(),
        status,
        errors: errors.length > 0 ? errors : undefined,
      };

      const duration = Date.now() - startTime;
      logger.info(`Analysis completed for ${token.symbol} in ${duration}ms. Score: ${scores.overallScore.toFixed(3)}`);

      return analysis;
    } catch (error: any) {
      logger.error(`Analysis failed for ${token.address}:`, error);
      
      return {
        tokenAddress: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        metrics: {},
        scores: {
          liquidityScore: 0,
          volumeScore: 0,
          ageScore: 0,
          overallScore: 0,
        },
        analyzedAt: new Date(),
        status: 'failed',
        errors: [error.message],
      };
    }
  }

  private calculateScores(metrics: TokenMetrics, token: TokenDiscovery) {
    // Liquidity Score (0-1)
    let liquidityScore = 0;
    if (metrics.liquidity) {
      // Good liquidity thresholds: $1k (min) to $100k (excellent)
      liquidityScore = this.normalizeScore(metrics.liquidity, 1000, 100000);
    }

    // Volume Score (0-1)
    let volumeScore = 0;
    if (metrics.volume24h && metrics.liquidity) {
      // Volume to liquidity ratio: 0.1 (low) to 2.0 (high activity)
      const volumeRatio = metrics.volume24h / metrics.liquidity;
      volumeScore = this.normalizeScore(volumeRatio, 0.1, 2.0);
    } else if (metrics.volume24h) {
      // Fallback: absolute volume $100 to $50k
      volumeScore = this.normalizeScore(metrics.volume24h, 100, 50000);
    }

    // Age Score (newer is better for memecoins)
    let ageScore = 0;
    if (metrics.ageHours !== undefined) {
      // Best: < 1 hour, Good: < 24 hours, Poor: > 168 hours (1 week)
      if (metrics.ageHours < 1) ageScore = 1;
      else if (metrics.ageHours < 24) ageScore = 0.8 - (metrics.ageHours / 30);
      else if (metrics.ageHours < 168) ageScore = 0.5 - (metrics.ageHours / 336);
      else ageScore = 0;
    }

    // Platform bonus
    let platformBonus = 0;
    if (token.platform === 'pumpfun') platformBonus = 0.1;
    else if (token.platform === 'raydium') platformBonus = 0.05;

    // Calculate overall score (weighted average)
    const weights = {
      liquidity: 0.4,
      volume: 0.3,
      age: 0.3,
    };

    let overallScore = 
      (liquidityScore * weights.liquidity) +
      (volumeScore * weights.volume) +
      (ageScore * weights.age);

    // Add platform bonus (max 10% boost)
    overallScore = Math.min(1, overallScore + platformBonus);

    return {
      liquidityScore: Math.round(liquidityScore * 1000) / 1000,
      volumeScore: Math.round(volumeScore * 1000) / 1000,
      ageScore: Math.round(ageScore * 1000) / 1000,
      overallScore: Math.round(overallScore * 1000) / 1000,
    };
  }

  private determineStatus(metrics: TokenMetrics, errors: string[]): 'success' | 'partial' | 'failed' {
    const hasPrice = metrics.price !== undefined;
    const hasVolume = metrics.volume24h !== undefined;
    const hasLiquidity = metrics.liquidity !== undefined;

    if (hasPrice && hasVolume && hasLiquidity) {
      return 'success';
    } else if (hasPrice || hasVolume || hasLiquidity) {
      return 'partial';
    } else {
      return 'failed';
    }
  }
}