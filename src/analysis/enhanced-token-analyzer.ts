// src/analysis/enhanced-token-analyzer.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { MarketMetricsAnalyzer, MarketMetrics } from './market-metrics-analyzer';
import { TokenDiscovery } from '../discovery/base-monitor';

export interface EnhancedAnalysisResult {
  tokenAddress: string;
  symbol: string;
  name: string;
  platform: string;
  
  // Market analysis
  marketMetrics: MarketMetrics | null;
  marketHealthScore: number;
  liquidityHealthScore: number;
  tradingActivityScore: number;
  
  // Risk assessment
  securityScore: number;
  manipulationRisk: number;
  rugPullRisk: number;
  overallRiskScore: number;
  
  // Investment classification
  investmentTier: 'HIDDEN_GEM' | 'NEW_BURST' | 'STANDARD' | 'AVOID' | 'HIGH_RISK';
  confidenceScore: number;
  
  // Strategic analysis
  strategy: string[];
  reasoningPoints: string[];
  alertFlags: string[];
  
  // Composite scores
  compositeScore: number;
  potentialScore: number;
  
  // Analysis metadata
  analysisTimestamp: Date;
  dataSourcesUsed: string[];
  processingTimeMs: number;
}

export class EnhancedTokenAnalyzer extends EventEmitter {
  private marketMetricsAnalyzer: MarketMetricsAnalyzer;
  private isRunning: boolean = false;
  
  // Thresholds for different classifications
  private readonly thresholds = {
    hiddenGem: {
      marketCapMin: 30000,
      marketCapMax: 100000,
      liquidityMin: 15000,
      volumeMin: 5000,
      manipulationMax: 0.3,
    },
    newBurst: {
      marketCapMin: 250000,
      marketCapMax: 1000000,
      volumeMin: 25000,
      priceChangeMin: 0.1, // 10% price increase
      ageMaxHours: 48,
    },
    highRisk: {
      manipulationMin: 0.7,
      rugPullMin: 0.8,
      liquidityMax: 5000,
    },
  };

  constructor() {
    super();
    this.marketMetricsAnalyzer = new MarketMetricsAnalyzer();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.marketMetricsAnalyzer.on('metricsUpdated', (metrics: MarketMetrics) => {
      this.emit('marketMetricsUpdated', metrics);
    });

    this.marketMetricsAnalyzer.on('alert', (alert) => {
      this.emit('marketAlert', alert);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Enhanced Token Analyzer already running');
      return;
    }

    logger.info('Starting Enhanced Token Analyzer...');
    this.isRunning = true;

    // Start the market metrics analyzer
    await this.marketMetricsAnalyzer.start();

    logger.info('Enhanced Token Analyzer started successfully');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Enhanced Token Analyzer...');
    this.isRunning = false;

    await this.marketMetricsAnalyzer.stop();

    logger.info('Enhanced Token Analyzer stopped');
  }

  async analyzeToken(token: TokenDiscovery): Promise<EnhancedAnalysisResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting enhanced analysis for ${token.symbol} (${token.address})`);

      // Get existing basic analysis
      const basicAnalysis = await this.getBasicAnalysis(token.address);
      
      // Perform market metrics analysis
      const marketMetrics = await this.marketMetricsAnalyzer.analyzeTokenMetrics(token.address);
      
      // Calculate various scores
      const marketHealthScore = this.calculateMarketHealthScore(marketMetrics);
      const liquidityHealthScore = this.calculateLiquidityHealthScore(marketMetrics);
      const tradingActivityScore = this.calculateTradingActivityScore(marketMetrics);
      const securityScore = this.calculateSecurityScore(basicAnalysis, marketMetrics);
      const manipulationRisk = marketMetrics?.manipulationScore || 0;
      const rugPullRisk = this.calculateRugPullRisk(basicAnalysis, marketMetrics);
      
      // Overall risk assessment
      const overallRiskScore = this.calculateOverallRiskScore(
        securityScore,
        manipulationRisk,
        rugPullRisk,
        liquidityHealthScore
      );
      
      // Investment tier classification
      const { investmentTier, confidenceScore } = this.classifyInvestmentTier(
        token,
        marketMetrics,
        marketHealthScore,
        overallRiskScore
      );
      
      // Strategic analysis
      const strategy = this.determineStrategy(token, marketMetrics, investmentTier);
      const reasoningPoints = this.generateReasoningPoints(
        token,
        marketMetrics,
        marketHealthScore,
        overallRiskScore,
        investmentTier
      );
      const alertFlags = this.generateAlertFlags(marketMetrics, overallRiskScore);
      
      // Composite scores
      const potentialScore = this.calculatePotentialScore(
        marketHealthScore,
        tradingActivityScore,
        investmentTier
      );
      const compositeScore = this.calculateCompositeScore(
        potentialScore,
        securityScore,
        overallRiskScore
      );
      
      const processingTime = Date.now() - startTime;
      
      const result: EnhancedAnalysisResult = {
        tokenAddress: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        
        marketMetrics,
        marketHealthScore,
        liquidityHealthScore,
        tradingActivityScore,
        
        securityScore,
        manipulationRisk,
        rugPullRisk,
        overallRiskScore,
        
        investmentTier,
        confidenceScore,
        
        strategy,
        reasoningPoints,
        alertFlags,
        
        compositeScore,
        potentialScore,
        
        analysisTimestamp: new Date(),
        dataSourcesUsed: this.getDataSourcesUsed(marketMetrics),
        processingTimeMs: processingTime,
      };
      
      // Store enhanced analysis results
      await this.storeEnhancedAnalysis(result);
      
      // Update token record with enhanced scores
      await this.updateTokenRecord(token.address, result);
      
      // Emit analysis complete event
      this.emit('analysisComplete', result);
      
      logger.info(`Enhanced analysis completed for ${token.symbol} in ${processingTime}ms - Tier: ${investmentTier}, Score: ${compositeScore.toFixed(3)}`);
      
      return result;
    } catch (error) {
      logger.error(`Enhanced analysis failed for ${token.address}:`, error);
      throw error;
    }
  }

  private async getBasicAnalysis(tokenAddress: string): Promise<any> {
    try {
      const tokenRecord = await db('tokens')
        .select('*')
        .where('address', tokenAddress)
        .first();
      
      return {
        safety_score: parseFloat(tokenRecord?.safety_score || '0.5'),
        potential_score: parseFloat(tokenRecord?.potential_score || '0.5'),
        raw_data: tokenRecord?.raw_data || {},
        market_cap: parseFloat(tokenRecord?.market_cap || '0'),
        liquidity: parseFloat(tokenRecord?.liquidity || '0'),
        created_at: tokenRecord?.created_at,
      };
    } catch (error) {
      logger.error(`Failed to get basic analysis for ${tokenAddress}:`, error);
      return {};
    }
  }

  private calculateMarketHealthScore(marketMetrics: MarketMetrics | null): number {
    if (!marketMetrics) return 0.1;

    let score = 0;

    // Liquidity score (30%)
    if (marketMetrics.liquidityUsd) {
      if (marketMetrics.liquidityUsd > 100000) score += 0.3;
      else if (marketMetrics.liquidityUsd > 50000) score += 0.25;
      else if (marketMetrics.liquidityUsd > 25000) score += 0.2;
      else if (marketMetrics.liquidityUsd > 10000) score += 0.15;
      else score += (marketMetrics.liquidityUsd / 10000) * 0.15;
    }

    // Volume score (25%)
    if (marketMetrics.volume24h) {
      if (marketMetrics.volume24h > 100000) score += 0.25;
      else if (marketMetrics.volume24h > 50000) score += 0.2;
      else if (marketMetrics.volume24h > 25000) score += 0.15;
      else if (marketMetrics.volume24h > 10000) score += 0.1;
      else score += (marketMetrics.volume24h / 10000) * 0.1;
    }

    // Price stability score (20%)
    if (marketMetrics.volatility1h !== undefined) {
      const stabilityScore = Math.max(0, 1 - marketMetrics.volatility1h * 2);
      score += stabilityScore * 0.2;
    }

    // Trading activity score (15%)
    if (marketMetrics.trades1h) {
      if (marketMetrics.trades1h > 100) score += 0.15;
      else score += (marketMetrics.trades1h / 100) * 0.15;
    }

    // Market cap appropriateness (10%)
    if (marketMetrics.marketCap) {
      // Sweet spot for market cap (not too low, not too high)
      if (marketMetrics.marketCap >= 50000 && marketMetrics.marketCap <= 5000000) {
        score += 0.1;
      } else if (marketMetrics.marketCap >= 10000) {
        score += 0.05;
      }
    }

    return Math.min(1, score);
  }

  private calculateLiquidityHealthScore(marketMetrics: MarketMetrics | null): number {
    if (!marketMetrics || !marketMetrics.liquidityUsd) return 0;

    let score = 0;

    // Base liquidity score
    const liquidity = marketMetrics.liquidityUsd;
    if (liquidity > 200000) score += 0.4;
    else if (liquidity > 100000) score += 0.35;
    else if (liquidity > 50000) score += 0.3;
    else if (liquidity > 25000) score += 0.25;
    else if (liquidity > 10000) score += 0.2;
    else score += (liquidity / 10000) * 0.2;

    // Slippage score
    if (marketMetrics.slippage1Percent !== undefined) {
      if (marketMetrics.slippage1Percent < 0.01) score += 0.3; // Less than 1% slippage
      else if (marketMetrics.slippage1Percent < 0.03) score += 0.25;
      else if (marketMetrics.slippage1Percent < 0.05) score += 0.2;
      else if (marketMetrics.slippage1Percent < 0.1) score += 0.15;
      else score += 0.1;
    }

    // Liquidity stability
    if (marketMetrics.liquidityChange1h !== undefined) {
      const stabilityScore = Math.max(0, 1 - Math.abs(marketMetrics.liquidityChange1h));
      score += stabilityScore * 0.3;
    }

    return Math.min(1, score);
  }

  private calculateTradingActivityScore(marketMetrics: MarketMetrics | null): number {
    if (!marketMetrics) return 0;

    let score = 0;

    // Volume consistency
    if (marketMetrics.volume24h && marketMetrics.volume1h) {
      const hourlyRate = marketMetrics.volume1h / (marketMetrics.volume24h / 24);
      if (hourlyRate > 0.5 && hourlyRate < 2) score += 0.3; // Consistent volume
      else if (hourlyRate > 0.2 && hourlyRate < 3) score += 0.2;
      else score += 0.1;
    }

    // Trading frequency
    if (marketMetrics.trades1h) {
      if (marketMetrics.trades1h > 50) score += 0.3;
      else if (marketMetrics.trades1h > 20) score += 0.25;
      else if (marketMetrics.trades1h > 10) score += 0.2;
      else score += (marketMetrics.trades1h / 10) * 0.2;
    }

    // Average trade size appropriateness
    if (marketMetrics.avgTradeSize) {
      // Good if between $100-$10,000
      if (marketMetrics.avgTradeSize >= 100 && marketMetrics.avgTradeSize <= 10000) {
        score += 0.2;
      } else if (marketMetrics.avgTradeSize >= 50) {
        score += 0.1;
      }
    }

    // Volume trend
    if (marketMetrics.volumeChange1h !== undefined) {
      if (marketMetrics.volumeChange1h > 0) score += 0.2; // Growing volume is good
      else if (marketMetrics.volumeChange1h > -0.2) score += 0.1; // Stable volume is okay
    }

    return Math.min(1, score);
  }

  private calculateSecurityScore(basicAnalysis: any, marketMetrics: MarketMetrics | null): number {
    let score = basicAnalysis.safety_score || 0.5;

    // Adjust based on market metrics
    if (marketMetrics) {
      // Lower score for high manipulation
      score *= (1 - marketMetrics.manipulationScore * 0.5);
      
      // Lower score for pump and dump patterns
      score *= (1 - marketMetrics.pumpDumpScore * 0.3);
      
      // Lower score for wash trading
      score *= (1 - marketMetrics.washTradingScore * 0.2);
    }

    return Math.max(0, Math.min(1, score));
  }

  private calculateRugPullRisk(basicAnalysis: any, marketMetrics: MarketMetrics | null): number {
    let risk = 0;

    // Base risk from liquidity
    if (marketMetrics?.liquidityUsd) {
      if (marketMetrics.liquidityUsd < 5000) risk += 0.4;
      else if (marketMetrics.liquidityUsd < 15000) risk += 0.3;
      else if (marketMetrics.liquidityUsd < 30000) risk += 0.2;
      else if (marketMetrics.liquidityUsd < 50000) risk += 0.1;
    }

    // Risk from manipulation patterns
    if (marketMetrics) {
      risk += marketMetrics.manipulationScore * 0.3;
      risk += marketMetrics.pumpDumpScore * 0.4;
    }

    // Risk from trading patterns
    if (marketMetrics?.trades1h !== undefined && marketMetrics.trades1h < 5) {
      risk += 0.2; // Very low trading activity
    }

    return Math.min(1, risk);
  }

  private calculateOverallRiskScore(
    securityScore: number,
    manipulationRisk: number,
    rugPullRisk: number,
    liquidityHealthScore: number
  ): number {
    // Higher values = higher risk
    const riskFromSecurity = 1 - securityScore;
    const riskFromLiquidity = 1 - liquidityHealthScore;
    
    // Weighted average of risk factors
    return (
      riskFromSecurity * 0.3 +
      manipulationRisk * 0.3 +
      rugPullRisk * 0.25 +
      riskFromLiquidity * 0.15
    );
  }

  private classifyInvestmentTier(
    token: TokenDiscovery,
    marketMetrics: MarketMetrics | null,
    marketHealthScore: number,
    overallRiskScore: number
  ): { investmentTier: EnhancedAnalysisResult['investmentTier'], confidenceScore: number } {
    
    // High risk classification
    if (overallRiskScore > 0.7 || 
        (marketMetrics && marketMetrics.manipulationScore > this.thresholds.highRisk.manipulationMin)) {
      return { investmentTier: 'HIGH_RISK', confidenceScore: 0.9 };
    }

    // Avoid classification
    if (overallRiskScore > 0.8 || marketHealthScore < 0.2) {
      return { investmentTier: 'AVOID', confidenceScore: 0.85 };
    }

    const marketCap = marketMetrics?.marketCap || 0;
    const volume24h = marketMetrics?.volume24h || 0;
    const liquidityUsd = marketMetrics?.liquidityUsd || 0;
    const ageHours = token.createdAt ? (Date.now() - token.createdAt.getTime()) / (1000 * 60 * 60) : 0;

    // Hidden Gem classification
    if (marketCap >= this.thresholds.hiddenGem.marketCapMin &&
        marketCap <= this.thresholds.hiddenGem.marketCapMax &&
        liquidityUsd >= this.thresholds.hiddenGem.liquidityMin &&
        volume24h >= this.thresholds.hiddenGem.volumeMin &&
        overallRiskScore < 0.4 &&
        marketHealthScore > 0.6) {
      return { investmentTier: 'HIDDEN_GEM', confidenceScore: 0.8 };
    }

    // New Burst classification
    if (marketCap >= this.thresholds.newBurst.marketCapMin &&
        marketCap <= this.thresholds.newBurst.marketCapMax &&
        volume24h >= this.thresholds.newBurst.volumeMin &&
        ageHours <= this.thresholds.newBurst.ageMaxHours &&
        (marketMetrics?.priceChange24h || 0) >= this.thresholds.newBurst.priceChangeMin &&
        overallRiskScore < 0.5) {
      return { investmentTier: 'NEW_BURST', confidenceScore: 0.75 };
    }

    // Standard classification
    if (marketHealthScore > 0.4 && overallRiskScore < 0.6) {
      return { investmentTier: 'STANDARD', confidenceScore: 0.6 };
    }

    // Default to AVOID if doesn't meet other criteria
    return { investmentTier: 'AVOID', confidenceScore: 0.7 };
  }

  private determineStrategy(
    token: TokenDiscovery,
    marketMetrics: MarketMetrics | null,
    tier: EnhancedAnalysisResult['investmentTier']
  ): string[] {
    const strategies = [];

    switch (tier) {
      case 'HIDDEN_GEM':
        strategies.push('EARLY_ENTRY');
        strategies.push('HOLD_FOR_PUMP_FUN_GRADUATION');
        if (marketMetrics?.trendDirection === 'UP') {
          strategies.push('MOMENTUM_PLAY');
        }
        break;

      case 'NEW_BURST':
        strategies.push('QUICK_SCALP');
        strategies.push('MOMENTUM_TRADING');
        if (marketMetrics?.volume24h && marketMetrics.volume24h > 100000) {
          strategies.push('HIGH_VOLUME_BREAKOUT');
        }
        break;

      case 'STANDARD':
        strategies.push('WAIT_AND_OBSERVE');
        if (marketMetrics?.trendDirection === 'UP' && marketMetrics.trendStrength > 0.6) {
          strategies.push('TREND_FOLLOWING');
        }
        break;

      case 'HIGH_RISK':
        strategies.push('AVOID_OR_VERY_SMALL_POSITION');
        strategies.push('MONITOR_FOR_CHANGES');
        break;

      case 'AVOID':
        strategies.push('DO_NOT_INVEST');
        break;
    }

    return strategies;
  }

  private generateReasoningPoints(
    token: TokenDiscovery,
    marketMetrics: MarketMetrics | null,
    marketHealthScore: number,
    overallRiskScore: number,
    tier: EnhancedAnalysisResult['investmentTier']
  ): string[] {
    const points = [];

    // Market health reasoning
    if (marketHealthScore > 0.7) {
      points.push(`Strong market health (${(marketHealthScore * 100).toFixed(1)}%)`);
    } else if (marketHealthScore < 0.3) {
      points.push(`Weak market health (${(marketHealthScore * 100).toFixed(1)}%)`);
    }

    // Liquidity reasoning
    if (marketMetrics?.liquidityUsd) {
      if (marketMetrics.liquidityUsd > 100000) {
        points.push(`Excellent liquidity ($${(marketMetrics.liquidityUsd / 1000).toFixed(0)}K)`);
      } else if (marketMetrics.liquidityUsd < 10000) {
        points.push(`Low liquidity risk ($${(marketMetrics.liquidityUsd / 1000).toFixed(0)}K)`);
      }
    }

    // Volume reasoning
    if (marketMetrics?.volume24h) {
      if (marketMetrics.volume24h > 50000) {
        points.push(`High trading volume ($${(marketMetrics.volume24h / 1000).toFixed(0)}K 24h)`);
      } else if (marketMetrics.volume24h < 5000) {
        points.push(`Low trading activity ($${(marketMetrics.volume24h / 1000).toFixed(0)}K 24h)`);
      }
    }

    // Risk reasoning
    if (overallRiskScore > 0.7) {
      points.push(`High risk profile (${(overallRiskScore * 100).toFixed(1)}%)`);
    } else if (overallRiskScore < 0.3) {
      points.push(`Low risk profile (${(overallRiskScore * 100).toFixed(1)}%)`);
    }

    // Manipulation reasoning
    if (marketMetrics?.manipulationScore && marketMetrics.manipulationScore > 0.5) {
      points.push(`Potential manipulation detected (${(marketMetrics.manipulationScore * 100).toFixed(1)}%)`);
    }

    // Trend reasoning
    if (marketMetrics?.trendDirection && marketMetrics.trendStrength > 0.5) {
      points.push(`Strong ${marketMetrics.trendDirection.toLowerCase()} trend`);
    }

    // Age reasoning
    const ageHours = token.createdAt ? (Date.now() - token.createdAt.getTime()) / (1000 * 60 * 60) : 0;
    if (ageHours < 1) {
      points.push('Very new token (high risk/reward)');
    } else if (ageHours < 24) {
      points.push('New token (elevated risk)');
    }

    return points;
  }

  private generateAlertFlags(marketMetrics: MarketMetrics | null, overallRiskScore: number): string[] {
    const flags = [];

    if (!marketMetrics) {
      flags.push('INSUFFICIENT_MARKET_DATA');
      return flags;
    }

    // Risk flags
    if (overallRiskScore > 0.8) flags.push('EXTREME_RISK');
    else if (overallRiskScore > 0.6) flags.push('HIGH_RISK');

    // Manipulation flags
    if (marketMetrics.manipulationScore > 0.7) flags.push('MANIPULATION_DETECTED');
    if (marketMetrics.pumpDumpScore > 0.6) flags.push('PUMP_DUMP_PATTERN');
    if (marketMetrics.washTradingScore > 0.5) flags.push('WASH_TRADING');

    // Liquidity flags
    if (marketMetrics.liquidityUsd && marketMetrics.liquidityUsd < 5000) {
      flags.push('VERY_LOW_LIQUIDITY');
    }

    // Volume flags
    if (marketMetrics.volumeChange1h && marketMetrics.volumeChange1h > 10) {
      flags.push('EXTREME_VOLUME_SPIKE');
    }

    // Price flags
    if (marketMetrics.priceChange1h && Math.abs(marketMetrics.priceChange1h) > 0.5) {
      flags.push('EXTREME_PRICE_MOVEMENT');
    }

    // Volatility flags
    if (marketMetrics.volatility1h && marketMetrics.volatility1h > 0.8) {
      flags.push('EXTREME_VOLATILITY');
    }

    return flags;
  }

  private calculatePotentialScore(
    marketHealthScore: number,
    tradingActivityScore: number,
    tier: EnhancedAnalysisResult['investmentTier']
  ): number {
    let score = (marketHealthScore + tradingActivityScore) / 2;

    // Tier-based adjustments
    switch (tier) {
      case 'HIDDEN_GEM':
        score *= 1.3; // 30% bonus for hidden gems
        break;
      case 'NEW_BURST':
        score *= 1.2; // 20% bonus for new burst
        break;
      case 'HIGH_RISK':
        score *= 0.5; // 50% penalty for high risk
        break;
      case 'AVOID':
        score *= 0.3; // 70% penalty for avoid
        break;
    }

    return Math.min(1, score);
  }

  private calculateCompositeScore(
    potentialScore: number,
    securityScore: number,
    overallRiskScore: number
  ): number {
    // Weighted composite: 40% potential, 35% security, 25% risk (inverted)
    return (
      potentialScore * 0.4 +
      securityScore * 0.35 +
      (1 - overallRiskScore) * 0.25
    );
  }

  private getDataSourcesUsed(marketMetrics: MarketMetrics | null): string[] {
    const sources = ['database'];
    
    if (marketMetrics) {
      sources.push('dexscreener', 'internal_calculation');
    }
    
    return sources;
  }

  private async storeEnhancedAnalysis(result: EnhancedAnalysisResult): Promise<void> {
    try {
      await db('token_analysis_history').insert({
        token_address: result.tokenAddress,
        analyzed_at: result.analysisTimestamp,
        
        // Store analysis results as JSON
        security_data: JSON.stringify({
          securityScore: result.securityScore,
          manipulationRisk: result.manipulationRisk,
          rugPullRisk: result.rugPullRisk,
          overallRiskScore: result.overallRiskScore,
        }),
        
        trading_data: JSON.stringify({
          marketHealthScore: result.marketHealthScore,
          liquidityHealthScore: result.liquidityHealthScore,
          tradingActivityScore: result.tradingActivityScore,
          marketMetrics: result.marketMetrics,
        }),
        
        // Scores
        safety_score: result.securityScore,
        potential_score: result.potentialScore,
        composite_score: result.compositeScore,
        
        // ML data
        ml_classification: result.investmentTier,
        ml_confidence: result.confidenceScore,
      });
    } catch (error) {
      logger.error('Failed to store enhanced analysis:', error);
    }
  }

  private async updateTokenRecord(tokenAddress: string, result: EnhancedAnalysisResult): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          safety_score: result.securityScore,
          potential_score: result.potentialScore,
          composite_score: result.compositeScore,
          investment_classification: result.investmentTier,
          analysis_status: 'COMPLETED',
          updated_at: new Date(),
          
          // Update market data if available
          ...(result.marketMetrics?.marketCap && { market_cap: result.marketMetrics.marketCap }),
          ...(result.marketMetrics?.liquidityUsd && { liquidity: result.marketMetrics.liquidityUsd }),
          ...(result.marketMetrics?.volume24h && { volume_24h: result.marketMetrics.volume24h }),
          ...(result.marketMetrics?.current_price && { current_price: result.marketMetrics.current_price }),
        });
    } catch (error) {
      logger.error('Failed to update token record:', error);
    }
  }

  // Public methods for external access
  async getEnhancedAnalysis(tokenAddress: string): Promise<EnhancedAnalysisResult | null> {
    try {
      const tokenData = await db('tokens')
        .select('*')
        .where('address', tokenAddress)
        .first();

      if (!tokenData) return null;

      const marketMetrics = await this.marketMetricsAnalyzer.getTokenMetrics(tokenAddress);
      
      // Reconstruct the analysis result
      return {
        tokenAddress: tokenData.address,
        symbol: tokenData.symbol,
        name: tokenData.name,
        platform: tokenData.platform,
        
        marketMetrics,
        marketHealthScore: this.calculateMarketHealthScore(marketMetrics),
        liquidityHealthScore: this.calculateLiquidityHealthScore(marketMetrics),
        tradingActivityScore: this.calculateTradingActivityScore(marketMetrics),
        
        securityScore: parseFloat(tokenData.safety_score || '0'),
        manipulationRisk: marketMetrics?.manipulationScore || 0,
        rugPullRisk: this.calculateRugPullRisk({}, marketMetrics),
        overallRiskScore: 1 - parseFloat(tokenData.safety_score || '0.5'),
        
        investmentTier: tokenData.investment_classification || 'STANDARD',
        confidenceScore: 0.7,
        
        strategy: [],
        reasoningPoints: [],
        alertFlags: [],
        
        compositeScore: parseFloat(tokenData.composite_score || '0'),
        potentialScore: parseFloat(tokenData.potential_score || '0'),
        
        analysisTimestamp: tokenData.updated_at || new Date(),
        dataSourcesUsed: ['database'],
        processingTimeMs: 0,
      };
    } catch (error) {
      logger.error(`Failed to get enhanced analysis for ${tokenAddress}:`, error);
      return null;
    }
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      marketAnalyzer: this.marketMetricsAnalyzer.getStats(),
    };
  }
}



