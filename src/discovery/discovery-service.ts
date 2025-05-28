// src/discovery/discovery-service.ts - Updated for Module 2B1
import { EventEmitter } from 'events';
import { DiscoveryManager } from './discovery-manager';
import { TokenProcessor } from './token-processor';
import { DeduplicationService } from './deduplication-service';
import { PumpFunMonitor } from './pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { EnhancedTokenAnalyzer } from '../analysis/enhanced-token-analyzer';
import { MarketMetricsAnalyzer } from '../analysis/market-metrics-analyzer';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';

export class DiscoveryService extends EventEmitter {
  private discoveryManager: DiscoveryManager;
  private tokenProcessor: TokenProcessor;
  private deduplicationService: DeduplicationService;
  private enhancedAnalyzer: EnhancedTokenAnalyzer;
  private marketAnalyzer: MarketMetricsAnalyzer;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.discoveryManager = new DiscoveryManager();
    this.tokenProcessor = new TokenProcessor();
    this.deduplicationService = new DeduplicationService();
    this.enhancedAnalyzer = new EnhancedTokenAnalyzer();
    this.marketAnalyzer = new MarketMetricsAnalyzer();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Discovery Service with Enhanced Analysis');

    // Initialize discovery manager
    await this.discoveryManager.initialize();

    // Initialize analyzers
    await this.enhancedAnalyzer.start();
    await this.marketAnalyzer.start();

    // Set up event handlers
    this.setupEventHandlers();

    // Register monitors
    this.discoveryManager.registerMonitor(new PumpFunMonitor());
    this.discoveryManager.registerMonitor(new RaydiumMonitor());

    logger.info('Discovery Service with Enhanced Analysis initialized');
  }

  private setupEventHandlers(): void {
    // Handle discovered tokens
    this.discoveryManager.on('tokenDiscovered', async (token) => {
      // Check for duplicates
      if (this.deduplicationService.isDuplicate(token.address, token.platform)) {
        logger.debug(`Duplicate token filtered: ${token.address}`);
        return;
      }

      // Calculate priority based on platform and age
      const priority = this.calculatePriority(token);

      // Add to processing queue
      await this.tokenProcessor.addToken(token, priority);
    });

    // Handle processed tokens - now with enhanced analysis
    this.tokenProcessor.on('tokenReady', async (token) => {
      logger.info(`Token ready for enhanced analysis: ${token.symbol} (${token.address})`);
      
      try {
        // Perform enhanced analysis
        const analysis = await this.enhancedAnalyzer.analyzeToken(token);
        
        logger.info(`Enhanced analysis completed for ${token.symbol}: ${analysis.investmentTier} (${(analysis.compositeScore * 100).toFixed(1)}%)`);
        
        // Emit analysis results for further processing
        this.emit('tokenAnalyzed', analysis);
        
        // Log high-potential tokens
        if (analysis.investmentTier === 'HIDDEN_GEM' || analysis.investmentTier === 'NEW_BURST') {
          logger.info(`🚀 HIGH POTENTIAL TOKEN: ${token.symbol} - ${analysis.investmentTier} - Score: ${(analysis.compositeScore * 100).toFixed(1)}%`);
          logger.info(`   Market Cap: $${analysis.marketMetrics?.marketCap?.toLocaleString()}, Volume: $${analysis.marketMetrics?.volume24h?.toLocaleString()}`);
          logger.info(`   Risk Score: ${(analysis.overallRiskScore * 100).toFixed(1)}%, Confidence: ${(analysis.confidenceScore * 100).toFixed(1)}%`);
          
          // Emit high-potential alert
          this.emit('highPotentialToken', analysis);
        }
        
        // Log high-risk tokens
        if (analysis.investmentTier === 'HIGH_RISK' || analysis.alertFlags.length > 0) {
          logger.warn(`⚠️ HIGH RISK TOKEN: ${token.symbol} - Flags: ${analysis.alertFlags.join(', ')}`);
        }
        
      } catch (error) {
        logger.error(`Enhanced analysis failed for ${token.symbol}:`, error);
      }
    });

    // Handle failed tokens
    this.tokenProcessor.on('tokenFailed', (token, error) => {
      logger.error(`Token processing failed: ${token.address}`, error);
    });

    // Handle market alerts
    this.enhancedAnalyzer.on('marketAlert', (alert) => {
      logger.info(`🚨 MARKET ALERT: ${alert.alertType} for ${alert.tokenAddress} - ${alert.message}`);
      this.emit('marketAlert', alert);
    });

    // Handle enhanced analysis completion
    this.enhancedAnalyzer.on('analysisComplete', (analysis) => {
      // Store performance metrics
      this.recordAnalysisPerformance(analysis);
    });

    // Handle market metrics updates
    this.enhancedAnalyzer.on('marketMetricsUpdated', (metrics) => {
      // Could emit to WebSocket clients for real-time updates
      this.emit('marketMetricsUpdated', metrics);
    });
  }

  private calculatePriority(token: any): number {
    let priority = 50; // Base priority

    // Platform priorities
    if (token.platform === 'pumpfun') priority += 20;
    if (token.platform === 'raydium') priority += 15;

    // Age priority (newer = higher)
    const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
    if (ageMinutes < 5) priority += 30;
    else if (ageMinutes < 15) priority += 20;
    else if (ageMinutes < 60) priority += 10;

    // Market cap priority (if available)
    if (token.metadata?.marketCap) {
      if (token.metadata.marketCap < 100000) priority += 15;
      else if (token.metadata.marketCap < 500000) priority += 10;
    }

    // Enhanced priority for potential hidden gems
    if (token.metadata?.marketCap >= 30000 && token.metadata?.marketCap <= 100000) {
      priority += 25; // Boost for hidden gem range
    }

    return Math.min(100, Math.max(0, priority));
  }

  private async recordAnalysisPerformance(analysis: any): Promise<void> {
    try {
      // Record performance metrics every 10 analyses
      if (Math.random() < 0.1) { // 10% sampling
        const performanceData = {
          analysis_type: 'enhanced_analysis',
          tokens_processed: 1,
          avg_processing_time_ms: analysis.processingTimeMs,
          success_rate: 1.0,
          api_calls_made: analysis.dataSourcesUsed.length,
          cost_usd: this.estimateAnalysisCost(analysis),
        };

        await db('analysis_performance').insert(performanceData);
      }
    } catch (error) {
      logger.error('Failed to record analysis performance:', error);
    }
  }

  private estimateAnalysisCost(analysis: any): number {
    // Rough cost estimation based on API calls
    let cost = 0;
    
    if (analysis.dataSourcesUsed.includes('dexscreener')) cost += 0.001; // Free
    if (analysis.dataSourcesUsed.includes('birdeye')) cost += 0.005;
    if (analysis.dataSourcesUsed.includes('moralis')) cost += 0.003;
    if (analysis.dataSourcesUsed.includes('helius')) cost += 0.002;
    if (analysis.dataSourcesUsed.includes('solsniffer')) cost += 0.01;
    
    return cost;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Discovery Service is already running');
      return;
    }

    logger.info('Starting Discovery Service with Enhanced Analysis');
    this.isRunning = true;

    // Start all monitors
    await this.discoveryManager.startAll();

    // Start continuous analysis monitoring
    this.startAnalysisMonitoring();

    logger.info('Discovery Service with Enhanced Analysis started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Discovery Service is not running');
      return;
    }

    logger.info('Stopping Discovery Service');
    this.isRunning = false;

    // Stop all monitors
    await this.discoveryManager.stopAll();

    // Stop analyzers
    await this.enhancedAnalyzer.stop();
    await this.marketAnalyzer.stop();

    // Clear processing queue
    await this.tokenProcessor.clear();

    // Stop deduplication service
    this.deduplicationService.stop();

    logger.info('Discovery Service stopped');
  }

  private startAnalysisMonitoring(): void {
    // Monitor analysis performance every 5 minutes
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const stats = this.getStats();
        
        // Log performance summary
        logger.info(`📊 Analysis Performance Summary:`);
        logger.info(`   Tokens Monitored: ${stats.marketAnalysis.tokensMonitored}`);
        logger.info(`   Discovery Queue: ${stats.processing.queueSize}`);
        logger.info(`   Deduplication Rate: ${stats.deduplication.totalUnique} unique tokens`);
        
        // Check for performance issues
        if (stats.processing.queueSize > 100) {
          logger.warn(`High processing queue size: ${stats.processing.queueSize}`);
        }
        
        if (stats.processing.queueSize === 0 && stats.discovery.totalDiscovered > 0) {
          logger.info('✅ All discovered tokens processed');
        }
        
      } catch (error) {
        logger.error('Failed to monitor analysis performance:', error);
      }
    }, 300000); // 5 minutes

    // Monitor high-potential tokens every minute
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const recentGems = await this.getRecentHighPotentialTokens();
        
        if (recentGems.length > 0) {
          logger.info(`💎 Recent High-Potential Tokens (last hour): ${recentGems.length}`);
          for (const gem of recentGems.slice(0, 3)) { // Show top 3
            logger.info(`   ${gem.symbol}: ${gem.investment_classification} (${(gem.composite_score * 100).toFixed(1)}%)`);
          }
        }
      } catch (error) {
        logger.error('Failed to monitor high-potential tokens:', error);
      }
    }, 60000); // 1 minute
  }

  private async getRecentHighPotentialTokens(): Promise<any[]> {
    try {
      return await db('tokens')
        .select('symbol', 'name', 'address', 'investment_classification', 'composite_score', 'discovered_at')
        .whereIn('investment_classification', ['HIDDEN_GEM', 'NEW_BURST'])
        .where('discovered_at', '>', db.raw("NOW() - INTERVAL '1 HOUR'"))
        .orderBy('composite_score', 'desc')
        .limit(10);
    } catch (error) {
      return [];
    }
  }

  // Public methods for external access
  getEnhancedAnalyzer(): EnhancedTokenAnalyzer {
    return this.enhancedAnalyzer;
  }

  getMarketAnalyzer(): MarketMetricsAnalyzer {
    return this.marketAnalyzer;
  }

  async analyzeSpecificToken(tokenAddress: string): Promise<any> {
    try {
      const token = await db('tokens')
        .select('*')
        .where('address', tokenAddress)
        .first();

      if (!token) {
        throw new Error('Token not found');
      }

      const tokenDiscovery = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.created_at || new Date(),
        metadata: token.raw_data || {},
      };

      return await this.enhancedAnalyzer.analyzeToken(tokenDiscovery);
    } catch (error) {
      logger.error(`Failed to analyze specific token ${tokenAddress}:`, error);
      throw error;
    }
  }

  async getTokenAnalysis(tokenAddress: string): Promise<any> {
    return await this.enhancedAnalyzer.getEnhancedAnalysis(tokenAddress);
  }

  async getRecentAlerts(limit: number = 10): Promise<any[]> {
    return await this.marketAnalyzer.getRecentAlerts(limit);
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      discovery: this.discoveryManager.getStats(),
      processing: this.tokenProcessor.getStats(),
      deduplication: this.deduplicationService.getStats(),
      analysis: this.enhancedAnalyzer.getStats(),
      marketAnalysis: this.marketAnalyzer.getStats(),
    };
  }
}

// Export singleton instance
export const discoveryService = new DiscoveryService();