import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TokenAnalysis, AnalysisResult, InvestmentClassification } from './types';
import { db } from '../database/postgres';
import { writeTokenMetrics } from '../database/questdb';
import { apiManager } from '../integrations/api-manager';

export class TokenAnalyzer extends EventEmitter {
  private analyzing: Set<string> = new Set();

  async analyzeToken(address: string): Promise<AnalysisResult> {
    if (this.analyzing.has(address)) {
      logger.warn(`Already analyzing token ${address}`);
      throw new Error('Analysis already in progress');
    }

    this.analyzing.add(address);

    try {
      logger.info(`Starting analysis for token ${address}`);
      const startTime = Date.now();

      // Fetch data from multiple sources in parallel
      const [
        tokenData,
        marketData,
        holderData,
        securityData,
        liquidityData
      ] = await Promise.allSettled([
        apiManager.getTokenData(address),
        apiManager.getMarketData(address),
        apiManager.getHolderData(address),
        apiManager.getSecurityData(address),
        apiManager.getLiquidityData(address)
      ]);

      // Extract successful results
      const token = tokenData.status === 'fulfilled' ? tokenData.value : null;
      const market = marketData.status === 'fulfilled' ? marketData.value : null;
      const holders = holderData.status === 'fulfilled' ? holderData.value : null;
      const security = securityData.status === 'fulfilled' ? securityData.value : null;
      const liquidity = liquidityData.status === 'fulfilled' ? liquidityData.value : null;

      // If we couldn't get basic token data, we can't proceed
      if (!token) {
        logger.warn(`No token data available for ${address}`);
        throw new Error('Unable to fetch token data from any API');
      }

      // Calculate scores based on available data
      const scores = this.calculateScores(token, market, holders, security, liquidity);

      // Generate investment classification
      const classification = this.classifyInvestment(scores);

      // Build analysis result
      const analysis: AnalysisResult = {
        tokenAddress: address,
        symbol: token.symbol,
        name: token.name,
        analyzedAt: new Date(),
        
        // Market metrics
        price: token.price,
        marketCap: token.marketCap,
        volume24h: token.volume24h,
        liquidity: token.liquidity,
        priceChange24h: token.priceChange24h || 0,
        holders: token.holders || 0,
        
        // Analysis scores
        safetyScore: scores.safety,
        potentialScore: scores.potential,
        liquidityScore: scores.liquidity,
        communityScore: scores.community,
        momentumScore: scores.momentum,
        compositeScore: scores.composite,
        
        // Classification
        classification: classification as InvestmentClassification,
        confidence: scores.confidence,
        
        // Raw data for detailed analysis
        rawData: {
          token,
          market,
          holders,
          security,
          liquidity
        }
      };

      // Store analysis results
      await this.storeAnalysis(analysis);

      const duration = Date.now() - startTime;
      logger.info(`Analysis completed for ${token.symbol} (${address}) in ${duration}ms - Score: ${scores.composite.toFixed(3)}, Classification: ${classification}`);

      this.emit('analysisComplete', analysis);
      return analysis;

    } catch (error) {
      logger.error(`Analysis failed for ${address}:`, error);
      throw error;
    } finally {
      this.analyzing.delete(address);
    }
  }

  private calculateScores(
    token: any,
    market: any,
    holders: any,
    security: any,
    liquidity: any
  ) {
    // Safety Score (0-1, higher is safer)
    let safetyScore = 0.5; // Base score
    
    if (security) {
      // Reduce score for security risks
      safetyScore -= security.rugPullRisk * 0.3;
      if (security.honeypotRisk) safetyScore -= 0.2;
      if (security.mintable) safetyScore -= 0.1;
      if (security.freezable) safetyScore -= 0.05;
      
      // Increase score for positive security features
      if (security.lpBurned) safetyScore += 0.1;
      if (security.contractVerified) safetyScore += 0.05;
      if (security.topHolderConcentration < 50) safetyScore += 0.1;
    }

    // Liquidity Score (0-1, higher is better)
    let liquidityScore = 0;
    if (liquidity && liquidity.totalLiquidityUSD > 0) {
      // Log scale for liquidity (max out at $1M)
      liquidityScore = Math.min(1, Math.log10(liquidity.totalLiquidityUSD + 1) / 6);
      
      // Bonus for multiple pools
      if (liquidity.poolCount > 1) liquidityScore += 0.1;
    } else if (token.liquidity > 0) {
      // Fallback to token liquidity
      liquidityScore = Math.min(1, Math.log10(token.liquidity + 1) / 6);
    }

    // Community Score (0-1, based on holders)
    let communityScore = 0;
    if (holders) {
      // Log scale for holder count (max out at 10k holders)
      communityScore = Math.min(1, Math.log10(holders.totalHolders + 1) / 4);
      
      // Reduce score for high concentration
      if (holders.top10Percentage > 80) communityScore *= 0.5;
      else if (holders.top10Percentage > 60) communityScore *= 0.7;
      else if (holders.top10Percentage > 40) communityScore *= 0.9;
    } else if (token.holders > 0) {
      // Fallback to token holders
      communityScore = Math.min(1, Math.log10(token.holders + 1) / 4);
    }

    // Momentum Score (0-1, based on volume and price action)
    let momentumScore = 0.5;
    if (market || token.volume24h > 0) {
      const volume = market?.volume24h || token.volume24h;
      const priceChange = market?.priceChange24h || token.priceChange24h || 0;
      
      // Volume to liquidity ratio (healthy is 0.1-2.0)
      const volToLiq = liquidity 
        ? volume / (liquidity.totalLiquidityUSD || 1)
        : volume / (token.liquidity || 1);
      
      if (volToLiq > 0.1 && volToLiq < 2.0) {
        momentumScore = 0.6;
      }
      
      // Price momentum
      if (priceChange > 0 && priceChange < 50) momentumScore += 0.2;
      else if (priceChange > 50) momentumScore += 0.1; // Too high might be pump
      else if (priceChange < -20) momentumScore -= 0.2;
    }

    // Potential Score (combination of factors)
    let potentialScore = 0;
    
    // Market cap potential (lower mcap = higher potential)
    if (token.marketCap > 0) {
      if (token.marketCap < 100000) potentialScore += 0.3;
      else if (token.marketCap < 500000) potentialScore += 0.2;
      else if (token.marketCap < 1000000) potentialScore += 0.1;
    }
    
    // Add other scores
    potentialScore += liquidityScore * 0.3;
    potentialScore += communityScore * 0.2;
    potentialScore += momentumScore * 0.2;

    // Normalize all scores to 0-1 range
    safetyScore = Math.max(0, Math.min(1, safetyScore));
    liquidityScore = Math.max(0, Math.min(1, liquidityScore));
    communityScore = Math.max(0, Math.min(1, communityScore));
    momentumScore = Math.max(0, Math.min(1, momentumScore));
    potentialScore = Math.max(0, Math.min(1, potentialScore));

    // Calculate composite score (weighted average)
    const weights = {
      safety: 0.35,
      liquidity: 0.25,
      community: 0.15,
      momentum: 0.15,
      potential: 0.10
    };

    const composite = 
      safetyScore * weights.safety +
      liquidityScore * weights.liquidity +
      communityScore * weights.community +
      momentumScore * weights.momentum +
      potentialScore * weights.potential;

    // Confidence based on data availability
    let dataPoints = 0;
    if (token) dataPoints++;
    if (market) dataPoints++;
    if (holders) dataPoints++;
    if (security) dataPoints++;
    if (liquidity) dataPoints++;
    const confidence = dataPoints / 5;

    return {
      safety: safetyScore,
      liquidity: liquidityScore,
      community: communityScore,
      momentum: momentumScore,
      potential: potentialScore,
      composite,
      confidence
    };
  }

  private classifyInvestment(scores: any): InvestmentClassification {
    const { composite, safety, liquidity } = scores;

    // High-level classification based on composite score and key factors
    if (composite >= 0.8 && safety >= 0.7 && liquidity >= 0.6) {
      return 'STRONG_BUY';
    } else if (composite >= 0.65 && safety >= 0.5) {
      return 'BUY';
    } else if (composite >= 0.5 && safety >= 0.4) {
      return 'CONSIDER';
    } else if (composite >= 0.35 || safety >= 0.3) {
      return 'MONITOR';
    } else if (safety < 0.3) {
      return 'HIGH_RISK';
    } else {
      return 'AVOID';
    }
  }

  private async storeAnalysis(analysis: AnalysisResult): Promise<void> {
    try {
      // Update token record
      await db('tokens')
        .where('address', analysis.tokenAddress)
        .update({
          symbol: analysis.symbol,
          name: analysis.name,
          price: analysis.price,
          market_cap: analysis.marketCap,
          volume_24h: analysis.volume24h,
          liquidity: analysis.liquidity,
          safety_score: analysis.safetyScore,
          potential_score: analysis.potentialScore,
          composite_score: analysis.compositeScore,
          analysis_status: 'COMPLETED',
          investment_classification: analysis.classification,
          updated_at: new Date()
        });

      // Store analysis history
      await db('token_analysis_history').insert({
        token_address: analysis.tokenAddress,
        analyzed_at: analysis.analyzedAt,
        holders_data: JSON.stringify(analysis.rawData.holders || {}),
        security_data: JSON.stringify(analysis.rawData.security || {}),
        liquidity_data: JSON.stringify(analysis.rawData.liquidity || {}),
        trading_data: JSON.stringify(analysis.rawData.market || {}),
        safety_score: analysis.safetyScore,
        potential_score: analysis.potentialScore,
        composite_score: analysis.compositeScore,
        ml_classification: analysis.classification,
        ml_confidence: analysis.confidence
      });

      // Write to QuestDB for time-series analysis
      await writeTokenMetrics({
        address: analysis.tokenAddress,
        price: analysis.price,
        market_cap: analysis.marketCap,
        volume_24h: analysis.volume24h,
        holders: analysis.holders,
        safety_score: analysis.safetyScore,
        timestamp: analysis.analyzedAt
      });

    } catch (error) {
      logger.error('Failed to store analysis results:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      analyzing: Array.from(this.analyzing),
      activeAnalyses: this.analyzing.size
    };
  }
}