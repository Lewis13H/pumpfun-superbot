// src/analysis/tiered-analyzer.ts
import { TokenDiscovery } from '../discovery/base-monitor';
import { SolSnifferClient, SolSnifferTokenAnalysis } from '../api/solsniffer-client';
import { BirdeyeClient, BirdeyeTokenData } from '../api/birdeye-client';
import { DexScreenerClient, DexScreenerPair } from '../api/dexscreener-client';
import { MoralisClient, MoralisHolderData } from '../api/moralis-client';
import { HeliusClient, HeliusEnhancedData } from '../api/helius-client';
import { logger } from '../utils/logger';
import { config } from '../config';

export type AnalysisLevel = 'PREMIUM' | 'STANDARD' | 'BASIC' | 'MINIMAL';

export interface TokenAnalysisResult {
  tokenAddress: string;
  analysisLevel: AnalysisLevel;
  timestamp: Date;
  
  // Consolidated scores
  securityScore: number; // 0-1, higher is safer
  potentialScore: number; // 0-1, higher is better potential
  compositeScore: number; // 0-1, overall score
  
  // Risk classification
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  investmentTier: 'HIDDEN_GEM' | 'NEW_BURST' | 'STANDARD' | 'AVOID';
  
  // Raw API data (available based on analysis level)
  securityData?: SolSnifferTokenAnalysis;
  marketData?: BirdeyeTokenData;
  pairData?: DexScreenerPair[];
  holderData?: MoralisHolderData[];
  enhancedData?: HeliusEnhancedData | Partial<HeliusEnhancedData>;
  
  // Analysis metadata
  costIncurred: number;
  processingTime: number;
  warnings: string[];
  confidence: number; // How confident we are in the analysis
}

export class TieredTokenAnalyzer {
  private solsniffer: SolSnifferClient;
  private birdeye: BirdeyeClient;
  private dexscreener: DexScreenerClient;
  private moralis: MoralisClient;
  private helius: HeliusClient;
  
  private dailySpend: Map<string, number> = new Map();
  
  constructor() {
    this.solsniffer = new SolSnifferClient(config.apis.solsnifferApiKey);
    this.birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
    this.dexscreener = new DexScreenerClient();
    this.moralis = new MoralisClient(config.apis.moralisApiKey);
    this.helius = new HeliusClient(config.apis.heliusRpcUrl);
  }

  async analyzeToken(token: TokenDiscovery): Promise<TokenAnalysisResult> {
    const startTime = Date.now();
    const analysisLevel = this.determineAnalysisLevel(token);
    
    logger.info(`Starting ${analysisLevel} analysis for ${token.symbol} (${token.address})`);
    
    let result: TokenAnalysisResult;
    
    try {
      switch (analysisLevel) {
        case 'PREMIUM':
          result = await this.premiumAnalysis(token);
          break;
        case 'STANDARD':
          result = await this.standardAnalysis(token);
          break;
        case 'BASIC':
          result = await this.basicAnalysis(token);
          break;
        default:
          result = await this.minimalAnalysis(token);
      }
      
      result.processingTime = Date.now() - startTime;
      
      logger.info(`Analysis completed for ${token.symbol}: Score=${result.compositeScore.toFixed(3)}, Tier=${result.investmentTier}, Cost=$${result.costIncurred.toFixed(3)}`);
      
      return result;
      
    } catch (error) {
      logger.error(`Analysis failed for ${token.address}:`, error);
      
      // Return minimal analysis on failure
      return await this.minimalAnalysis(token, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private determineAnalysisLevel(token: TokenDiscovery): AnalysisLevel {
    const initialScore = token.metadata?.initialScore || 0.5;
    const marketCap = token.metadata?.marketCap || 0;
    const strategy = token.metadata?.strategy || 'STANDARD';
    const ageMinutes = (Date.now() - token.createdAt.getTime()) / (1000 * 60);
    
    // Check daily spend limits
    const todaySpend = this.getDailySpend();
    
    // Premium analysis (use all APIs) - ~$0.025/token
    if (todaySpend < 15 && ( // Keep under $20/day budget with buffer
      initialScore > 0.7 || 
      strategy === 'HIDDEN_GEM' ||
      (marketCap > 30000 && marketCap < 100000 && ageMinutes < 60) // New promising tokens
    )) {
      return 'PREMIUM';
    }
    
    // Standard analysis (most APIs) - ~$0.012/token
    if (todaySpend < 18 && (
      initialScore > 0.5 || 
      marketCap > 50000 ||
      strategy === 'NEW_BURST'
    )) {
      return 'STANDARD';
    }
    
    // Basic analysis (free + cheap APIs) - ~$0.003/token
    if (todaySpend < 19.5 && initialScore > 0.3) {
      return 'BASIC';
    }
    
    // Minimal analysis (mostly free) - ~$0.001/token
    return 'MINIMAL';
  }

  private async premiumAnalysis(token: TokenDiscovery): Promise<TokenAnalysisResult> {
    logger.debug(`Premium analysis for ${token.address}`);
    
    // Use all API sources for comprehensive analysis
    const [
      securityResult,
      marketResult,
      pairResult,
      holderResult,
      enhancedResult
    ] = await Promise.allSettled([
      this.solsniffer.analyzeToken(token.address),
      this.birdeye.getTokenOverview(token.address),
      this.dexscreener.getTokenPairs(token.address),
      this.moralis.getTokenHolders(token.address, 50),
      this.helius.getEnhancedTokenData(token.address)
    ]);

    const warnings: string[] = [];
    
    // Extract successful results and note failures
    const securityData = securityResult.status === 'fulfilled' ? securityResult.value : undefined;
    const marketData = marketResult.status === 'fulfilled' ? marketResult.value : undefined;
    const pairData = pairResult.status === 'fulfilled' ? pairResult.value : undefined;
    const holderData = holderResult.status === 'fulfilled' ? holderResult.value : undefined;
    const enhancedData = enhancedResult.status === 'fulfilled' ? enhancedResult.value : undefined;
    
    if (securityResult.status === 'rejected') warnings.push('Security analysis failed');
    if (marketResult.status === 'rejected') warnings.push('Market data unavailable');
    if (holderResult.status === 'rejected') warnings.push('Holder analysis failed');
    
    // Calculate comprehensive scores
    const securityScore = this.calculateSecurityScore(securityData, pairData, holderData);
    const potentialScore = this.calculatePotentialScore(marketData, pairData, enhancedData, token);
    const compositeScore = (securityScore * 0.4) + (potentialScore * 0.6); // Weight potential higher
    
    return {
      tokenAddress: token.address,
      analysisLevel: 'PREMIUM',
      timestamp: new Date(),
      securityScore,
      potentialScore,
      compositeScore,
      riskLevel: this.determineRiskLevel(securityScore, warnings),
      investmentTier: this.determineInvestmentTier(compositeScore, securityScore, token),
      securityData,
      marketData,
      pairData,
      holderData,
      enhancedData,
      costIncurred: 0.025, // Estimated cost
      processingTime: 0, // Will be set by caller
      warnings,
      confidence: warnings.length > 2 ? 0.6 : 0.9 // Lower confidence if many API failures
    };
  }

  private async standardAnalysis(token: TokenDiscovery): Promise<TokenAnalysisResult> {
    logger.debug(`Standard analysis for ${token.address}`);
    
    // Use most APIs except expensive holder analysis
    const [
      securityResult,
      marketResult,
      pairResult,
      enhancedResult
    ] = await Promise.allSettled([
      this.solsniffer.analyzeToken(token.address),
      this.birdeye.getTokenOverview(token.address),
      this.dexscreener.getTokenPairs(token.address),
      this.helius.getBasicTokenData(token.address) // Use cheaper basic data
    ]);

    const warnings: string[] = [];
    
    const securityData = securityResult.status === 'fulfilled' ? securityResult.value : undefined;
    const marketData = marketResult.status === 'fulfilled' ? marketResult.value : undefined;
    const pairData = pairResult.status === 'fulfilled' ? pairResult.value : undefined;
    const enhancedData = enhancedResult.status === 'fulfilled' ? enhancedResult.value : undefined;
    
    if (securityResult.status === 'rejected') warnings.push('Security analysis failed');
    if (marketResult.status === 'rejected') warnings.push('Market data unavailable');
    
    const securityScore = this.calculateSecurityScore(securityData, pairData);
    const potentialScore = this.calculatePotentialScore(marketData, pairData, enhancedData, token);
    const compositeScore = (securityScore * 0.4) + (potentialScore * 0.6);
    
    return {
      tokenAddress: token.address,
      analysisLevel: 'STANDARD',
      timestamp: new Date(),
      securityScore,
      potentialScore,
      compositeScore,
      riskLevel: this.determineRiskLevel(securityScore, warnings),
      investmentTier: this.determineInvestmentTier(compositeScore, securityScore, token),
      securityData,
      marketData,
      pairData,
      enhancedData,
      costIncurred: 0.012,
      processingTime: 0,
      warnings,
      confidence: warnings.length > 1 ? 0.7 : 0.85
    };
  }

  private async basicAnalysis(token: TokenDiscovery): Promise<TokenAnalysisResult> {
    logger.debug(`Basic analysis for ${token.address}`);
    
    // Use free APIs plus minimal paid calls
    const [
      pairResult,
      enhancedResult
    ] = await Promise.allSettled([
      this.dexscreener.getTokenPairs(token.address),
      this.helius.getBasicTokenData(token.address)
    ]);

    const warnings: string[] = [];
    
    const pairData = pairResult.status === 'fulfilled' ? pairResult.value : undefined;
    const enhancedData = enhancedResult.status === 'fulfilled' ? enhancedResult.value : undefined;
    
    if (!pairData || pairData.length === 0) warnings.push('No trading pairs found');
    
    // Calculate scores with limited data
    const securityScore = this.calculateBasicSecurityScore(pairData);
    const potentialScore = this.calculateBasicPotentialScore(pairData, token);
    const compositeScore = (securityScore * 0.3) + (potentialScore * 0.7); // Weight potential higher with limited security data
    
    return {
      tokenAddress: token.address,
      analysisLevel: 'BASIC',
      timestamp: new Date(),
      securityScore,
      potentialScore,
      compositeScore,
      riskLevel: securityScore < 0.3 ? 'HIGH' : securityScore < 0.6 ? 'MEDIUM' : 'LOW',
      investmentTier: this.determineInvestmentTier(compositeScore, securityScore, token),
      pairData,
      enhancedData,
      costIncurred: 0.003,
      processingTime: 0,
      warnings,
      confidence: 0.6 // Lower confidence due to limited data
    };
  }

  private async minimalAnalysis(token: TokenDiscovery, errorMessage?: string): Promise<TokenAnalysisResult> {
    logger.debug(`Minimal analysis for ${token.address}`);
    
    const warnings: string[] = [];
    if (errorMessage) warnings.push(`Analysis error: ${errorMessage}`);
    
    // Use only free APIs and basic scoring
    let pairData: DexScreenerPair[] = [];
    
    try {
      pairData = await this.dexscreener.getTokenPairs(token.address);
    } catch (error) {
      warnings.push('Unable to fetch trading pairs');
    }
    
    // Basic scoring based on available metadata
    const securityScore = 0.5; // Neutral score when we can't analyze
    const potentialScore = this.calculateMinimalPotentialScore(token, pairData);
    const compositeScore = (securityScore * 0.2) + (potentialScore * 0.8); // Heavy weight on potential
    
    return {
      tokenAddress: token.address,
      analysisLevel: 'MINIMAL',
      timestamp: new Date(),
      securityScore,
      potentialScore,
      compositeScore,
      riskLevel: 'MEDIUM', // Default to medium risk when unknown
      investmentTier: compositeScore > 0.6 ? 'STANDARD' : 'AVOID',
      pairData,
      costIncurred: 0.001,
      processingTime: 0,
      warnings,
      confidence: 0.4 // Low confidence for minimal analysis
    };
  }

  // Scoring calculation methods
  private calculateSecurityScore(
    security?: SolSnifferTokenAnalysis, 
    pairs?: DexScreenerPair[], 
    holders?: MoralisHolderData[]
  ): number {
    let score = 0.5; // Base score
    
    if (security) {
      // SolSniffer provides inverted risk (high risk = low security)
      score += (1 - security.rugPullRisk) * 0.3;
      
      if (security.liquidityLocked) score += 0.15;
      if (security.lpBurned) score += 0.1;
      if (security.mintAuthorityRenounced) score += 0.1;
      if (security.topHolderPercentage < 0.1) score += 0.1; // Top holder < 10%
    }
    
    if (pairs && pairs.length > 0) {
      const mainPair = pairs[0];
      if (mainPair.liquidity > 10000) score += 0.1; // Decent liquidity
      if (mainPair.volume24h > 5000) score += 0.05; // Active trading
    }
    
    if (holders) {
      const top10Percentage = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
      if (top10Percentage < 50) score += 0.1; // Top 10 holders < 50%
    }
    
    return Math.min(1, Math.max(0, score));
  }

  private calculatePotentialScore(
    market?: BirdeyeTokenData, 
    pairs?: DexScreenerPair[], 
    enhanced?: HeliusEnhancedData | Partial<HeliusEnhancedData>,
    token?: TokenDiscovery
  ): number {
    let score = 0.3; // Base score
    
    if (market) {
      // Volume to market cap ratio (higher is better for new tokens)
      const volumeRatio = market.volume24h / Math.max(market.marketCap, 1);
      if (volumeRatio > 0.1) score += 0.2;
      else if (volumeRatio > 0.05) score += 0.1;
      
      // Holder growth (more holders = better distribution)
      if (market.holders > 100) score += 0.15;
      else if (market.holders > 50) score += 0.1;
      
      // Price trend (recent positive movement)
      if (market.priceChange24h > 20) score += 0.2;
      else if (market.priceChange24h > 5) score += 0.1;
      else if (market.priceChange24h < -20) score -= 0.1;
    }
    
    if (pairs && pairs.length > 0) {
      const mainPair = pairs[0];
      // Multiple trading venues
      if (pairs.length > 1) score += 0.1;
      
      // FDV in sweet spot for moonshots
      if (mainPair.fdv > 30000 && mainPair.fdv < 1000000) score += 0.15;
    }
    
    if (enhanced) {
      // High unique trader activity (safely check if property exists)
      if (enhanced.uniqueTraders24h && enhanced.uniqueTraders24h > 50) score += 0.1;
      
      // Low whale manipulation (safely check if property exists)
      if (enhanced.whaleActivity !== undefined && enhanced.whaleActivity < 0.3) score += 0.05;
    }
    
    // Token age bonus (newer tokens have higher moonshot potential)
    if (token) {
      const ageHours = (Date.now() - token.createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours < 24) score += 0.1;
      else if (ageHours < 168) score += 0.05; // Less than a week
    }
    
    return Math.min(1, Math.max(0, score));
  }

  private calculateBasicSecurityScore(pairs?: DexScreenerPair[]): number {
    let score = 0.4; // Lower base for limited data
    
    if (pairs && pairs.length > 0) {
      const mainPair = pairs[0];
      if (mainPair.liquidity > 20000) score += 0.2;
      if (mainPair.volume24h > 10000) score += 0.1;
      if (pairs.length > 1) score += 0.1; // Multiple pairs = more legitimate
    }
    
    return Math.min(1, Math.max(0, score));
  }

  private calculateBasicPotentialScore(pairs?: DexScreenerPair[], token?: TokenDiscovery): number {
    let score = 0.3;
    
    if (pairs && pairs.length > 0) {
      const mainPair = pairs[0];
      
      // Good volume relative to liquidity
      const volumeToLiq = mainPair.volume24h / Math.max(mainPair.liquidity, 1);
      if (volumeToLiq > 0.5) score += 0.3;
      else if (volumeToLiq > 0.2) score += 0.2;
      
      // Price change
      if (mainPair.priceChange24h > 10) score += 0.2;
      else if (mainPair.priceChange24h > 0) score += 0.1;
    }
    
    // Strategy bonus from initial classification
    if (token?.metadata?.strategy === 'HIDDEN_GEM') score += 0.2;
    else if (token?.metadata?.strategy === 'NEW_BURST') score += 0.15;
    
    return Math.min(1, Math.max(0, score));
  }

  private calculateMinimalPotentialScore(token: TokenDiscovery, pairs?: DexScreenerPair[]): number {
    let score = 0.2; // Very conservative base
    
    // Use initial metadata scoring
    const initialScore = token.metadata?.initialScore || 0;
    score += initialScore * 0.4;
    
    // Basic pair data
    if (pairs && pairs.length > 0) {
      score += 0.2; // At least it's tradeable
      if (pairs[0].volume24h > 1000) score += 0.1;
    }
    
    return Math.min(1, Math.max(0, score));
  }

  private determineRiskLevel(securityScore: number, warnings: string[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const warningCount = warnings.length;
    
    if (securityScore < 0.3 || warningCount >= 3) return 'CRITICAL';
    if (securityScore < 0.5 || warningCount >= 2) return 'HIGH';
    if (securityScore < 0.7 || warningCount >= 1) return 'MEDIUM';
    return 'LOW';
  }

  private determineInvestmentTier(
    compositeScore: number, 
    securityScore: number, 
    token: TokenDiscovery
  ): 'HIDDEN_GEM' | 'NEW_BURST' | 'STANDARD' | 'AVOID' {
    // Safety first - avoid if security is too low
    if (securityScore < 0.3) return 'AVOID';
    
    // High composite score with good security
    if (compositeScore > 0.75 && securityScore > 0.6) {
      return token.metadata?.strategy === 'HIDDEN_GEM' ? 'HIDDEN_GEM' : 'NEW_BURST';
    }
    
    // Decent score
    if (compositeScore > 0.55 && securityScore > 0.4) {
      return 'STANDARD';
    }
    
    return 'AVOID';
  }

  // Cost tracking methods
  private trackDailyCost(cost: number): void {
    const today = new Date().toISOString().split('T')[0];
    const currentCost = this.dailySpend.get(today) || 0;
    this.dailySpend.set(today, currentCost + cost);
  }

  private getDailySpend(): number {
    const today = new Date().toISOString().split('T')[0];
    return this.dailySpend.get(today) || 0;
  }

  // Public methods for monitoring
  public getAnalysisStats() {
    return {
      dailySpend: this.getDailySpend(),
      budgetRemaining: Math.max(0, 20 - this.getDailySpend()),
      costOptimizationActive: this.getDailySpend() > 15
    };
  }
}