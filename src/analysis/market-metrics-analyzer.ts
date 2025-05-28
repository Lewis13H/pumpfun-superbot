// src/analysis/market-metrics-analyzer.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { config } from '../config';

export interface MarketMetrics {
  tokenAddress: string;
  timestamp: Date;
  
  // Price metrics
  price: number;
  priceChange1m?: number;
  priceChange5m?: number;
  priceChange15m?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  
  // Volume metrics
  volume1m?: number;
  volume5m?: number;
  volume15m?: number;
  volume1h?: number;
  volume24h?: number;
  volumeChange1h?: number;
  
  // Liquidity metrics
  liquidityUsd?: number;
  liquidityChange1h?: number;
  buyPressure?: number;
  sellPressure?: number;
  
  // Trading metrics
  trades1m?: number;
  trades5m?: number;
  trades15m?: number;
  trades1h?: number;
  uniqueTraders1h?: number;
  avgTradeSize?: number;
  
  // Market health
  marketCap?: number;
  marketCapChange1h?: number;
  volatility1h?: number;
  slippage1Percent?: number;
  slippage5Percent?: number;
  
  // Risk indicators
  manipulationScore: number;
  washTradingScore: number;
  pumpDumpScore: number;
  
  // Pattern data
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  trendStrength: number;
  supportLevel?: number;
  resistanceLevel?: number;
}

export interface PriceAlert {
  tokenAddress: string;
  alertType: string;
  thresholdValue: number;
  currentValue: number;
  percentageChange: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export class MarketMetricsAnalyzer extends EventEmitter {
  private analysisIntervals: Map<string, NodeJS.Timeout> = new Map();
  private priceHistory: Map<string, Array<{price: number, timestamp: number}>> = new Map();
  private volumeHistory: Map<string, Array<{volume: number, timestamp: number}>> = new Map();
  private isRunning: boolean = false;
  
  private readonly thresholds = {
    priceSpike: 0.15, // 15% price change
    volumeSpike: 5.0, // 5x volume increase
    liquidityDrop: 0.30, // 30% liquidity decrease
    manipulationScore: 0.7, // High manipulation threshold
    volatilityHigh: 0.5, // High volatility threshold
  };

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Market Metrics Analyzer already running');
      return;
    }

    logger.info('Starting Market Metrics Analyzer...');
    this.isRunning = true;

    // Start continuous monitoring for active tokens
    await this.startContinuousMonitoring();
    
    logger.info('Market Metrics Analyzer started successfully');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Market Metrics Analyzer...');
    this.isRunning = false;

    // Clear all intervals
    for (const [tokenAddress, interval] of this.analysisIntervals) {
      clearInterval(interval);
      this.analysisIntervals.delete(tokenAddress);
    }

    logger.info('Market Metrics Analyzer stopped');
  }

  async startContinuousMonitoring(): Promise<void> {
    // Get active tokens that need monitoring
    const activeTokens = await this.getActiveTokens();
    
    logger.info(`Starting continuous monitoring for ${activeTokens.length} tokens`);

    for (const token of activeTokens) {
      await this.startTokenMonitoring(token.address);
    }

    // Periodically add new tokens to monitoring
    setInterval(async () => {
      if (!this.isRunning) return;
      
      const newTokens = await this.getNewActiveTokens();
      for (const token of newTokens) {
        await this.startTokenMonitoring(token.address);
      }
    }, 60000); // Check for new tokens every minute
  }

  async startTokenMonitoring(tokenAddress: string): Promise<void> {
    if (this.analysisIntervals.has(tokenAddress)) {
      return; // Already monitoring this token
    }

    // Different monitoring frequencies based on token activity
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    const monitoringInterval = this.getMonitoringInterval(tokenInfo);

    const interval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.analyzeTokenMetrics(tokenAddress);
      } catch (error) {
        logger.error(`Error analyzing token ${tokenAddress}:`, error);
      }
    }, monitoringInterval);

    this.analysisIntervals.set(tokenAddress, interval);
    logger.debug(`Started monitoring ${tokenAddress} with ${monitoringInterval}ms interval`);
  }

  async analyzeTokenMetrics(tokenAddress: string): Promise<MarketMetrics | null> {
    const startTime = Date.now();
    
    try {
      // Collect market data from multiple sources
      const marketData = await this.collectMarketData(tokenAddress);
      
      if (!marketData) {
        return null;
      }

      // Calculate comprehensive market metrics
      const metrics = await this.calculateMarketMetrics(tokenAddress, marketData);
      
      // Detect patterns and anomalies
      await this.detectPatterns(tokenAddress, metrics);
      
      // Check for alerts
      await this.checkAlerts(tokenAddress, metrics);
      
      // Store metrics in database
      await this.storeMetrics(metrics);
      
      // Emit event for other components
      this.emit('metricsUpdated', metrics);
      
      const processingTime = Date.now() - startTime;
      logger.debug(`Analyzed metrics for ${tokenAddress} in ${processingTime}ms`);
      
      return metrics;
    } catch (error) {
      logger.error(`Failed to analyze metrics for ${tokenAddress}:`, error);
      return null;
    }
  }

  private async collectMarketData(tokenAddress: string): Promise<any> {
    // Collect data from multiple sources with fallbacks
    const dataSources = await Promise.allSettled([
      this.getDexScreenerData(tokenAddress),
      this.getBirdeyeData(tokenAddress),
      this.getHeliusData(tokenAddress),
    ]);

    // Combine data from successful sources
    const validData = dataSources
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(data => data !== null);

    if (validData.length === 0) {
      return null;
    }

    // Merge data with preference for most recent/accurate
    return this.mergeMarketData(validData);
  }

  private async getDexScreenerData(tokenAddress: string): Promise<any> {
    try {
      // DexScreener API call (free tier)
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      const pair = data.pairs[0]; // Use first pair (usually highest volume)
      
      return {
        source: 'dexscreener',
        price: parseFloat(pair.priceUsd || '0'),
        volume24h: parseFloat(pair.volume?.h24 || '0'),
        volume1h: parseFloat(pair.volume?.h1 || '0'),
        priceChange24h: parseFloat(pair.priceChange?.h24 || '0') / 100,
        priceChange1h: parseFloat(pair.priceChange?.h1 || '0') / 100,
        liquidity: parseFloat(pair.liquidity?.usd || '0'),
        marketCap: parseFloat(pair.marketCap || '0'),
        txns24h: pair.txns?.h24?.buys + pair.txns?.h24?.sells || 0,
        txns1h: pair.txns?.h1?.buys + pair.txns?.h1?.sells || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.debug(`DexScreener API error for ${tokenAddress}:`, error);
      return null;
    }
  }

  private async getBirdeyeData(tokenAddress: string): Promise<any> {
    try {
      // Birdeye API with rate limiting
      if (!await this.checkRateLimit('birdeye')) {
        return null;
      }

      const response = await fetch(`https://public-api.birdeye.so/public/price?address=${tokenAddress}`, {
        headers: {
          'X-API-KEY': config.apis.birdeyeApiKey,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      return {
        source: 'birdeye',
        price: data.data?.value || 0,
        priceChange24h: data.data?.priceChange24h || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.debug(`Birdeye API error for ${tokenAddress}:`, error);
      return null;
    }
  }

  private async getHeliusData(tokenAddress: string): Promise<any> {
    try {
      // Helius enhanced data
      const response = await fetch(config.apis.heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenSupply',
          params: [tokenAddress],
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      return {
        source: 'helius',
        supply: data.result?.value?.uiAmount || 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.debug(`Helius API error for ${tokenAddress}:`, error);
      return null;
    }
  }

  private mergeMarketData(dataSources: any[]): any {
    const merged = {
      price: 0,
      volume24h: 0,
      volume1h: 0,
      priceChange24h: 0,
      priceChange1h: 0,
      liquidity: 0,
      marketCap: 0,
      txns24h: 0,
      txns1h: 0,
      supply: 0,
      sources: dataSources.map(d => d.source),
    };

    // Use most recent price data (DexScreener preferred)
    const priceSource = dataSources.find(d => d.source === 'dexscreener') || dataSources[0];
    if (priceSource) {
      merged.price = priceSource.price || 0;
      merged.volume24h = priceSource.volume24h || 0;
      merged.volume1h = priceSource.volume1h || 0;
      merged.priceChange24h = priceSource.priceChange24h || 0;
      merged.priceChange1h = priceSource.priceChange1h || 0;
      merged.liquidity = priceSource.liquidity || 0;
      merged.marketCap = priceSource.marketCap || 0;
      merged.txns24h = priceSource.txns24h || 0;
      merged.txns1h = priceSource.txns1h || 0;
    }

    // Add supply data from Helius
    const supplySource = dataSources.find(d => d.source === 'helius');
    if (supplySource) {
      merged.supply = supplySource.supply || 0;
    }

    return merged;
  }

  private async calculateMarketMetrics(tokenAddress: string, marketData: any): Promise<MarketMetrics> {
    // Update price history
    this.updatePriceHistory(tokenAddress, marketData.price);
    this.updateVolumeHistory(tokenAddress, marketData.volume1h || 0);

    const priceHistory = this.priceHistory.get(tokenAddress) || [];
    const volumeHistory = this.volumeHistory.get(tokenAddress) || [];

    // Calculate various metrics
    const metrics: MarketMetrics = {
      tokenAddress,
      timestamp: new Date(),
      price: marketData.price,
      priceChange1h: marketData.priceChange1h,
      priceChange24h: marketData.priceChange24h,
      volume1h: marketData.volume1h,
      volume24h: marketData.volume24h,
      liquidityUsd: marketData.liquidity,
      marketCap: marketData.marketCap,
      trades1h: marketData.txns1h,
      
      // Calculate derived metrics
      volatility1h: this.calculateVolatility(priceHistory),
      manipulationScore: this.calculateManipulationScore(priceHistory, volumeHistory, marketData),
      washTradingScore: this.calculateWashTradingScore(marketData),
      pumpDumpScore: this.calculatePumpDumpScore(priceHistory, volumeHistory),
      trendDirection: this.determineTrendDirection(priceHistory),
      trendStrength: this.calculateTrendStrength(priceHistory),
      
      // Calculate support/resistance levels
      supportLevel: this.calculateSupportLevel(priceHistory),
      resistanceLevel: this.calculateResistanceLevel(priceHistory),
    };

    // Calculate additional metrics
    if (volumeHistory.length > 1) {
      metrics.volumeChange1h = this.calculateVolumeChange(volumeHistory);
    }

    if (marketData.liquidity > 0) {
      metrics.slippage1Percent = this.estimateSlippage(marketData.liquidity, 0.01);
      metrics.slippage5Percent = this.estimateSlippage(marketData.liquidity, 0.05);
    }

    return metrics;
  }

  private updatePriceHistory(tokenAddress: string, price: number): void {
    if (!this.priceHistory.has(tokenAddress)) {
      this.priceHistory.set(tokenAddress, []);
    }

    const history = this.priceHistory.get(tokenAddress)!;
    history.push({ price, timestamp: Date.now() });

    // Keep only last 60 minutes of data (assuming 1-minute intervals)
    if (history.length > 60) {
      history.splice(0, history.length - 60);
    }
  }

  private updateVolumeHistory(tokenAddress: string, volume: number): void {
    if (!this.volumeHistory.has(tokenAddress)) {
      this.volumeHistory.set(tokenAddress, []);
    }

    const history = this.volumeHistory.get(tokenAddress)!;
    history.push({ volume, timestamp: Date.now() });

    // Keep only last 60 minutes of data
    if (history.length > 60) {
      history.splice(0, history.length - 60);
    }
  }

  private calculateVolatility(priceHistory: Array<{price: number, timestamp: number}>): number {
    if (priceHistory.length < 2) return 0;

    const prices = priceHistory.map(h => h.price);
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      if (prices[i-1] > 0) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
      }
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private calculateManipulationScore(
    priceHistory: Array<{price: number, timestamp: number}>,
    volumeHistory: Array<{volume: number, timestamp: number}>,
    marketData: any
  ): number {
    let score = 0;

    // Check for unusual price/volume correlation
    if (priceHistory.length > 5 && volumeHistory.length > 5) {
      const priceVolatility = this.calculateVolatility(priceHistory);
      const avgVolume = volumeHistory.reduce((sum, v) => sum + v.volume, 0) / volumeHistory.length;
      
      // High volatility with low volume is suspicious
      if (priceVolatility > 0.3 && avgVolume < 1000) {
        score += 0.3;
      }
    }

    // Check for pump and dump patterns
    if (priceHistory.length >= 10) {
      const recentPrices = priceHistory.slice(-10).map(h => h.price);
      const maxPrice = Math.max(...recentPrices);
      const minPrice = Math.min(...recentPrices);
      const currentPrice = recentPrices[recentPrices.length - 1];
      
      // Quick pump followed by dump
      if (maxPrice > minPrice * 2 && currentPrice < maxPrice * 0.7) {
        score += 0.4;
      }
    }

    // Check transaction patterns (if available)
    if (marketData.txns1h && marketData.volume1h) {
      const avgTradeSize = marketData.volume1h / marketData.txns1h;
      
      // Unusually large average trade size might indicate manipulation
      if (avgTradeSize > 10000) {
        score += 0.2;
      }
    }

    return Math.min(1, score);
  }

  private calculateWashTradingScore(marketData: any): number {
    let score = 0;

    // Look for patterns that suggest wash trading
    if (marketData.txns1h && marketData.volume1h) {
      const avgTradeSize = marketData.volume1h / marketData.txns1h;
      
      // Consistent trade sizes might indicate automated wash trading
      if (avgTradeSize > 0 && marketData.txns1h > 10) {
        // This is a simplified heuristic
        const tradeConsistency = 1 - (Math.abs(avgTradeSize - 1000) / 10000);
        if (tradeConsistency > 0.8) {
          score += 0.3;
        }
      }
    }

    return Math.min(1, Math.max(0, score));
  }

  private calculatePumpDumpScore(
    priceHistory: Array<{price: number, timestamp: number}>,
    volumeHistory: Array<{volume: number, timestamp: number}>
  ): number {
    if (priceHistory.length < 5 || volumeHistory.length < 5) return 0;

    const prices = priceHistory.map(h => h.price);
    const volumes = volumeHistory.map(h => h.volume);
    
    let score = 0;

    // Look for rapid price increase followed by rapid decrease
    const priceIncrease = (Math.max(...prices) - Math.min(...prices)) / Math.min(...prices);
    const recentPriceChange = (prices[prices.length - 1] - prices[0]) / prices[0];
    
    // High price increase followed by decline
    if (priceIncrease > 0.5 && recentPriceChange < 0.2) {
      score += 0.4;
    }

    // Check volume patterns during price movements
    const maxVolume = Math.max(...volumes);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    
    // Unusual volume spikes during price movements
    if (maxVolume > avgVolume * 5) {
      score += 0.3;
    }

    return Math.min(1, score);
  }

  private determineTrendDirection(priceHistory: Array<{price: number, timestamp: number}>): 'UP' | 'DOWN' | 'SIDEWAYS' {
    if (priceHistory.length < 5) return 'SIDEWAYS';

    const prices = priceHistory.map(h => h.price);
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, p) => sum + p, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, p) => sum + p, 0) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg;
    
    if (change > 0.05) return 'UP';
    if (change < -0.05) return 'DOWN';
    return 'SIDEWAYS';
  }

  private calculateTrendStrength(priceHistory: Array<{price: number, timestamp: number}>): number {
    if (priceHistory.length < 5) return 0;

    const prices = priceHistory.map(h => h.price);
    let trendStrength = 0;
    let consistentMoves = 0;
    
    for (let i = 1; i < prices.length; i++) {
      const change = (prices[i] - prices[i-1]) / prices[i-1];
      if (Math.abs(change) > 0.01) { // 1% minimum change
        consistentMoves++;
        trendStrength += Math.abs(change);
      }
    }
    
    if (consistentMoves === 0) return 0;
    
    return Math.min(1, (trendStrength / consistentMoves) * (consistentMoves / prices.length));
  }

  private calculateSupportLevel(priceHistory: Array<{price: number, timestamp: number}>): number | undefined {
    if (priceHistory.length < 10) return undefined;

    const prices = priceHistory.map(h => h.price);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    
    // Support level is around the 25th percentile
    const index = Math.floor(sortedPrices.length * 0.25);
    return sortedPrices[index];
  }

  private calculateResistanceLevel(priceHistory: Array<{price: number, timestamp: number}>): number | undefined {
    if (priceHistory.length < 10) return undefined;

    const prices = priceHistory.map(h => h.price);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    
    // Resistance level is around the 75th percentile
    const index = Math.floor(sortedPrices.length * 0.75);
    return sortedPrices[index];
  }

  private calculateVolumeChange(volumeHistory: Array<{volume: number, timestamp: number}>): number {
    if (volumeHistory.length < 2) return 0;

    const recent = volumeHistory.slice(-2);
    if (recent[0].volume === 0) return 0;
    
    return (recent[1].volume - recent[0].volume) / recent[0].volume;
  }

  private estimateSlippage(liquidity: number, tradePercent: number): number {
    if (liquidity <= 0) return 1; // 100% slippage if no liquidity
    
    // Simplified slippage calculation
    // Real slippage depends on AMM curve, but this gives a rough estimate
    const tradeSize = liquidity * tradePercent;
    return tradeSize / (liquidity * 2); // Rough approximation
  }

  private async detectPatterns(tokenAddress: string, metrics: MarketMetrics): Promise<void> {
    // Detect various trading patterns
    const patterns = [];

    // Breakout pattern
    if (metrics.trendStrength > 0.7 && metrics.trendDirection === 'UP' && metrics.volume24h && metrics.volume24h > 50000) {
      patterns.push({
        type: 'BREAKOUT',
        confidence: metrics.trendStrength,
        direction: 'UP',
        message: 'Strong upward breakout detected with high volume',
      });
    }

    // Reversal pattern
    if (metrics.pumpDumpScore > 0.6) {
      patterns.push({
        type: 'REVERSAL',
        confidence: metrics.pumpDumpScore,
        direction: 'DOWN',
        message: 'Potential pump and dump reversal pattern',
      });
    }

    // Accumulation pattern
    if (metrics.trendDirection === 'SIDEWAYS' && metrics.volume24h && metrics.volume24h > 25000) {
      patterns.push({
        type: 'ACCUMULATION',
        confidence: 0.6,
        direction: 'SIDEWAYS',
        message: 'Sideways accumulation with decent volume',
      });
    }

    // Store patterns in database
    for (const pattern of patterns) {
      await this.storePattern(tokenAddress, pattern);
    }
  }

  private async checkAlerts(tokenAddress: string, metrics: MarketMetrics): Promise<void> {
    const alerts: PriceAlert[] = [];

    // Price spike alert
    if (metrics.priceChange1h && Math.abs(metrics.priceChange1h) > this.thresholds.priceSpike) {
      alerts.push({
        tokenAddress,
        alertType: 'PRICE_SPIKE',
        thresholdValue: this.thresholds.priceSpike,
        currentValue: metrics.priceChange1h,
        percentageChange: metrics.priceChange1h * 100,
        severity: Math.abs(metrics.priceChange1h) > 0.3 ? 'CRITICAL' : 'HIGH',
        message: `Price ${metrics.priceChange1h > 0 ? 'increased' : 'decreased'} by ${(metrics.priceChange1h * 100).toFixed(1)}% in 1 hour`,
      });
    }

    // Volume spike alert
    if (metrics.volumeChange1h && metrics.volumeChange1h > this.thresholds.volumeSpike) {
      alerts.push({
        tokenAddress,
        alertType: 'VOLUME_SPIKE',
        thresholdValue: this.thresholds.volumeSpike,
        currentValue: metrics.volumeChange1h,
        percentageChange: metrics.volumeChange1h * 100,
        severity: metrics.volumeChange1h > 10 ? 'CRITICAL' : 'HIGH',
        message: `Volume increased by ${(metrics.volumeChange1h * 100).toFixed(1)}% in 1 hour`,
      });
    }

    // High manipulation score alert
    if (metrics.manipulationScore > this.thresholds.manipulationScore) {
      alerts.push({
        tokenAddress,
        alertType: 'MANIPULATION_RISK',
        thresholdValue: this.thresholds.manipulationScore,
        currentValue: metrics.manipulationScore,
        percentageChange: 0,
        severity: 'HIGH',
        message: `High manipulation risk detected (score: ${metrics.manipulationScore.toFixed(2)})`,
      });
    }

    // Store alerts
    for (const alert of alerts) {
      await this.storeAlert(alert);
      this.emit('alert', alert);
    }
  }

  private async storeMetrics(metrics: MarketMetrics): Promise<void> {
    try {
      await db('market_metrics_history').insert({
        token_address: metrics.tokenAddress,
        timestamp: metrics.timestamp,
        price: metrics.price,
        price_change_1m: metrics.priceChange1m,
        price_change_5m: metrics.priceChange5m,
        price_change_15m: metrics.priceChange15m,
        price_change_1h: metrics.priceChange1h,
        price_change_24h: metrics.priceChange24h,
        volume_1m: metrics.volume1m,
        volume_5m: metrics.volume5m,
        volume_15m: metrics.volume15m,
        volume_1h: metrics.volume1h,
        volume_24h: metrics.volume24h,
        volume_change_1h: metrics.volumeChange1h,
        liquidity_usd: metrics.liquidityUsd,
        liquidity_change_1h: metrics.liquidityChange1h,
        buy_pressure: metrics.buyPressure,
        sell_pressure: metrics.sellPressure,
        trades_1m: metrics.trades1m,
        trades_5m: metrics.trades5m,
        trades_15m: metrics.trades15m,
        trades_1h: metrics.trades1h,
        unique_traders_1h: metrics.uniqueTraders1h,
        avg_trade_size: metrics.avgTradeSize,
        market_cap: metrics.marketCap,
        market_cap_change_1h: metrics.marketCapChange1h,
        volatility_1h: metrics.volatility1h,
        slippage_1_percent: metrics.slippage1Percent,
        slippage_5_percent: metrics.slippage5Percent,
        manipulation_score: metrics.manipulationScore,
        wash_trading_score: metrics.washTradingScore,
        pump_dump_score: metrics.pumpDumpScore,
        trend_direction: metrics.trendDirection,
        trend_strength: metrics.trendStrength,
        support_level: metrics.supportLevel,
        resistance_level: metrics.resistanceLevel,
      });
    } catch (error) {
      logger.error('Failed to store market metrics:', error);
    }
  }

  private async storeAlert(alert: PriceAlert): Promise<void> {
    try {
      await db('price_alerts').insert({
        token_address: alert.tokenAddress,
        alert_type: alert.alertType,
        threshold_value: alert.thresholdValue,
        current_value: alert.currentValue,
        percentage_change: alert.percentageChange,
        severity: alert.severity,
        message: alert.message,
      });

      logger.info(`Alert generated: ${alert.message} for ${alert.tokenAddress}`);
    } catch (error) {
      logger.error('Failed to store alert:', error);
    }
  }

  private async storePattern(tokenAddress: string, pattern: any): Promise<void> {
    try {
      await db('trading_patterns').insert({
        token_address: tokenAddress,
        pattern_type: pattern.type,
        confidence_score: pattern.confidence,
        pattern_data: JSON.stringify(pattern),
        predicted_direction: pattern.direction,
        predicted_timeframe: '1h',
      });
    } catch (error) {
      logger.error('Failed to store trading pattern:', error);
    }
  }

  private async getActiveTokens(): Promise<Array<{address: string, symbol: string}>> {
    try {
      return await db('tokens')
        .select('address', 'symbol')
        .where('analysis_status', 'COMPLETED')
        .where('discovered_at', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
        .orderBy('composite_score', 'desc')
        .limit(100); // Monitor top 100 tokens
    } catch (error) {
      logger.error('Failed to get active tokens:', error);
      return [];
    }
  }

  private async getNewActiveTokens(): Promise<Array<{address: string, symbol: string}>> {
    try {
      // Get tokens that aren't currently being monitored
      const currentlyMonitored = Array.from(this.analysisIntervals.keys());
      
      const query = db('tokens')
        .select('address', 'symbol')
        .where('analysis_status', 'COMPLETED')
        .where('discovered_at', '>', db.raw("NOW() - INTERVAL '6 HOURS'"))
        .orderBy('discovered_at', 'desc')
        .limit(20);

      if (currentlyMonitored.length > 0) {
        query.whereNotIn('address', currentlyMonitored);
      }

      return await query;
    } catch (error) {
      logger.error('Failed to get new active tokens:', error);
      return [];
    }
  }

  private async getTokenInfo(tokenAddress: string): Promise<any> {
    try {
      return await db('tokens')
        .select('*')
        .where('address', tokenAddress)
        .first();
    } catch (error) {
      return null;
    }
  }

  private getMonitoringInterval(tokenInfo: any): number {
    if (!tokenInfo) return 300000; // 5 minutes default

    // High-potential tokens get monitored more frequently
    if (tokenInfo.composite_score > 0.8) return 60000; // 1 minute
    if (tokenInfo.composite_score > 0.6) return 120000; // 2 minutes
    if (tokenInfo.composite_score > 0.4) return 180000; // 3 minutes
    
    return 300000; // 5 minutes for lower-scoring tokens
  }

  private async checkRateLimit(service: string): Promise<boolean> {
    // Simple rate limiting - implement based on your API limits
    // For now, return true (implement proper rate limiting as needed)
    return true;
  }

  // Public methods for external access
  async getTokenMetrics(tokenAddress: string): Promise<MarketMetrics | null> {
    try {
      const latest = await db('market_metrics_history')
        .where('token_address', tokenAddress)
        .orderBy('timestamp', 'desc')
        .first();

      if (!latest) return null;

      return {
        tokenAddress: latest.token_address,
        timestamp: latest.timestamp,
        price: parseFloat(latest.price || '0'),
        priceChange1h: parseFloat(latest.price_change_1h || '0'),
        priceChange24h: parseFloat(latest.price_change_24h || '0'),
        volume1h: parseFloat(latest.volume_1h || '0'),
        volume24h: parseFloat(latest.volume_24h || '0'),
        liquidityUsd: parseFloat(latest.liquidity_usd || '0'),
        marketCap: parseFloat(latest.market_cap || '0'),
        volatility1h: parseFloat(latest.volatility_1h || '0'),
        manipulationScore: parseFloat(latest.manipulation_score || '0'),
        washTradingScore: parseFloat(latest.wash_trading_score || '0'),
        pumpDumpScore: parseFloat(latest.pump_dump_score || '0'),
        trendDirection: latest.trend_direction as 'UP' | 'DOWN' | 'SIDEWAYS',
        trendStrength: parseFloat(latest.trend_strength || '0'),
        supportLevel: latest.support_level ? parseFloat(latest.support_level) : undefined,
        resistanceLevel: latest.resistance_level ? parseFloat(latest.resistance_level) : undefined,
      };
    } catch (error) {
      logger.error(`Failed to get token metrics for ${tokenAddress}:`, error);
      return null;
    }
  }

  async getRecentAlerts(limit: number = 10): Promise<PriceAlert[]> {
    try {
      const alerts = await db('price_alerts')
        .select('*')
        .where('is_processed', false)
        .orderBy('triggered_at', 'desc')
        .limit(limit);

      return alerts.map(alert => ({
        tokenAddress: alert.token_address,
        alertType: alert.alert_type,
        thresholdValue: parseFloat(alert.threshold_value),
        currentValue: parseFloat(alert.current_value),
        percentageChange: parseFloat(alert.percentage_change),
        severity: alert.severity,
        message: alert.message,
      }));
    } catch (error) {
      logger.error('Failed to get recent alerts:', error);
      return [];
    }
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      tokensMonitored: this.analysisIntervals.size,
      priceHistorySize: this.priceHistory.size,
      volumeHistorySize: this.volumeHistory.size,
    };
  }
}