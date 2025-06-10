// src/grpc/grpc-stream-app.ts - ENHANCED WITH LIQUIDITY + VOLUME ANALYTICS v4.27

import { GrpcStreamManager } from './grpc-stream-manager';
import { db } from '../database/postgres';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
import { logger } from '../utils/logger2';
import { config } from '../config';
import { WebSocketService } from '../websocket/websocket-service';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';
import { HOLDER_ANALYTICS_SERVICE } from '../services/token-holder-analytics-service'; 

// Import Helius metadata service
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');

// Import enhanced liquidity services
import { LIQUIDITY_GROWTH_TRACKER } from '../services/liquidity-growth-tracker';
import { LIQUIDITY_QUALITY_SCORER } from '../services/liquidity-quality-scorer';
import { LIQUIDITY_MILESTONE_ALERTS } from '../services/liquidity-milestone-alerts';

// NEW V4.27: Import volume analytics service
import { VOLUME_ANALYTICS_SERVICE } from '../services/volume-analytics-service';

export class GrpcStreamApplication {
  private streamManager: GrpcStreamManager;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private wsService?: WebSocketService;
  private statsInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private metadataFixInterval?: NodeJS.Timeout;
  private holderAnalyticsInterval?: NodeJS.Timeout;
  // Liquidity analytics intervals
  private liquidityGrowthInterval?: NodeJS.Timeout;
  private liquidityQualityInterval?: NodeJS.Timeout;
  // NEW V4.27: Volume analytics interval
  private volumeAnalyticsInterval?: NodeJS.Timeout;
  
  constructor() {
    // Initialize without passing db - they'll use their own instances
    this.categoryManager = new CategoryManager();
    this.buySignalEvaluator = new BuySignalEvaluator();
    
    this.streamManager = new GrpcStreamManager(
      {
        grpcEndpoint: config.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
        grpcToken: config.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b',
        batchSize: config.GRPC_BATCH_SIZE || 1000,
        flushInterval: config.GRPC_FLUSH_INTERVAL || 1000,
        priceChangeInterval: config.PRICE_CHANGE_INTERVAL || 5 * 60 * 1000
      },
      db,
      this.categoryManager,
      this.buySignalEvaluator
    );
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Handle new tokens - ENHANCED WITH LIQUIDITY + VOLUME TRACKING
    this.streamManager.on('newToken', async (token: any) => {
      logger.info(`🎉 New token discovered: ${token.address.substring(0, 8)}... | Metadata & analytics queuing...`);
      
      // Queue for holder analysis  
      HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(token.address, 'HIGH');
      
      // Initialize liquidity tracking for new tokens
      LIQUIDITY_MILESTONE_ALERTS.emit('newTokenDetected', {
        tokenAddress: token.address,
        initialLiquidity: 0,
        timestamp: new Date()
      });
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('newToken', token);
      }
    });
    
    // Handle metadata updates from Shyft service
    this.streamManager.on('metadataUpdated', async (data: any) => {
      logger.info(`📝 Metadata updated: ${data.tokenAddress.substring(0, 8)}... → ${data.symbol} (${data.name})`);
      
      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('metadataUpdated', data);
      }
    });

    // Handle holder analytics updates
    HOLDER_ANALYTICS_SERVICE.on('holdersUpdated', async (holderMetrics: any) => {
      const tokenData = await db('tokens').where('address', holderMetrics.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : holderMetrics.tokenAddress.substring(0, 8) + '...';

      logger.info(`📊 Holders updated: ${displaySymbol} | ${holderMetrics.totalHolders} holders | Top 10%: ${holderMetrics.top10Percent}%`);

      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('holdersUpdated', {
          ...holderMetrics,
          symbol: displaySymbol
        });
      }

      // If this is an AIM token with fresh holder data, re-evaluate for buy signals
      if (tokenData?.category === 'AIM' && holderMetrics.totalHolders >= 30) {
        logger.info(`🎯 Re-evaluating AIM token ${displaySymbol} with fresh holder data`);
        
        setTimeout(async () => {
          try {
            const evaluation = await this.buySignalEvaluator.evaluateToken(holderMetrics.tokenAddress);
            if (evaluation.passed) {
              // Emit buy signal with holder context
              if (this.wsService) {
                this.wsService.broadcast('buySignal', { 
                  token: tokenData, 
                  signal: {
                    ...evaluation,
                    holderData: {
                      total: tokenData?.holders,
                      top10Concentration: tokenData?.top_10_percent,
                      top25Concentration: tokenData?.top_25_percent,
                      lastUpdated: tokenData?.holder_last_updated
                    }
                  }
                });
              }
            }
          } catch (error) {
            logger.error(`Error re-evaluating token after holder update:`, error);
          }
        }, 5000); // Wait 5 seconds for data to propagate
      }
    });

    // Handle liquidity milestone alerts
    LIQUIDITY_MILESTONE_ALERTS.on('milestoneAlert', async (alert: any) => {
      const tokenData = await db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`🎯 LIQUIDITY MILESTONE: ${displaySymbol} - ${alert.message}`);

      // Broadcast to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('liquidityMilestone', {
          ...alert,
          symbol: displaySymbol
        });
      }
    });

    // Handle critical liquidity milestones
    LIQUIDITY_MILESTONE_ALERTS.on('criticalMilestone', async (alert: any) => {
      const tokenData = await db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`🚨 CRITICAL LIQUIDITY: ${displaySymbol} - ${alert.message}`);

      // Broadcast to WebSocket clients with priority
      if (this.wsService) {
        this.wsService.broadcast('criticalLiquidityMilestone', {
          ...alert,
          symbol: displaySymbol,
          priority: 'CRITICAL'
        });
      }

      // If this is an AIM token with critical milestone, re-evaluate immediately
      if (tokenData?.category === 'AIM' && alert.actionable) {
        setTimeout(async () => {
          try {
            const evaluation = await this.buySignalEvaluator.evaluateToken(alert.tokenAddress);
            if (evaluation.passed) {
              logger.info(`🚨 CRITICAL MILESTONE BUY SIGNAL: ${displaySymbol}`);
              
              if (this.wsService) {
                this.wsService.broadcast('urgentBuySignal', {
                  token: tokenData,
                  signal: evaluation,
                  trigger: 'CRITICAL_LIQUIDITY_MILESTONE',
                  milestone: alert
                });
              }
            }
          } catch (error) {
            logger.error(`Error re-evaluating token after critical milestone:`, error);
          }
        }, 2000); // Faster response for critical events
      }
    });

    // Handle high quality liquidity events
    this.streamManager.on('highQualityLiquidity', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';

      logger.info(`💎 HIGH QUALITY LIQUIDITY: ${displaySymbol} - Grade: ${data.grade} (${data.score}/100)`);

      if (this.wsService) {
        this.wsService.broadcast('highQualityLiquidity', {
          ...data,
          symbol: displaySymbol
        });
      }
    });

    // Handle liquidity momentum events
    this.streamManager.on('liquidityMomentum', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';

      logger.info(`🚀 LIQUIDITY MOMENTUM: ${displaySymbol} - ${data.message}`);

      if (this.wsService) {
        this.wsService.broadcast('liquidityMomentum', {
          ...data,
          symbol: displaySymbol
        });
      }

      // If this is an AIM token with high momentum, evaluate for trading
      if (tokenData?.category === 'AIM' && data.momentum === 'HIGH') {
        setTimeout(async () => {
          try {
            const evaluation = await this.buySignalEvaluator.evaluateToken(data.tokenAddress);
            if (evaluation.passed) {
              logger.info(`🚀 MOMENTUM BUY SIGNAL: ${displaySymbol}`);
              
              if (this.wsService) {
                this.wsService.broadcast('momentumBuySignal', {
                  token: tokenData,
                  signal: evaluation,
                  trigger: 'HIGH_LIQUIDITY_MOMENTUM',
                  momentum: data
                });
              }
            }
          } catch (error) {
            logger.error(`Error evaluating token for momentum signal:`, error);
          }
        }, 3000);
      }
    });

    // NEW V4.27: Handle volume alerts
    this.streamManager.on('volumeAlert', async (alert: any) => {
      logger.info(`📊 Volume Alert: ${alert.symbol} - ${alert.message}`);
      
      if (this.wsService) {
        this.wsService.broadcast('volumeAlert', alert);
      }
    });

    // NEW V4.27: Handle critical volume alerts
    this.streamManager.on('criticalVolumeAlert', async (alert: any) => {
      logger.info(`🚨 Critical Volume Alert: ${alert.symbol} - ${alert.message}`);
      
      if (this.wsService) {
        this.wsService.broadcast('criticalVolumeAlert', alert);
      }
    });

    // NEW V4.27: Handle volume-triggered buy signals
    this.streamManager.on('volumeTriggeredBuySignal', async (data: any) => {
      logger.info(`🚨 VOLUME-TRIGGERED BUY SIGNAL: ${data.token.symbol || data.token.address.substring(0,8)+'...'}`);
      
      if (this.wsService) {
        this.wsService.broadcast('volumeTriggeredBuySignal', data);
      }
    });

    // NEW V4.27: Handle volume spikes
    this.streamManager.on('volumeSpike', async (alert: any) => {
      logger.info(`📈 Volume Spike: ${alert.symbol} - ${alert.details.percentageChange.toFixed(1)}% above average`);
      
      if (this.wsService) {
        this.wsService.broadcast('volumeSpike', alert);
      }
    });

    // NEW V4.27: Handle volume imbalances
    this.streamManager.on('volumeImbalance', async (alert: any) => {
      logger.info(`⚖️ Volume Imbalance: ${alert.symbol} - ${alert.message}`);
      
      if (this.wsService) {
        this.wsService.broadcast('volumeImbalance', alert);
      }
    });

    // NEW V4.27: Handle unusual volume patterns
    this.streamManager.on('unusualVolumePattern', async (alert: any) => {
      logger.info(`🔍 Unusual Volume Pattern: ${alert.symbol} - ${alert.message}`);
      
      if (this.wsService) {
        this.wsService.broadcast('unusualVolumePattern', alert);
      }
    });
    
    // Handle buy signals - ENHANCED WITH LIQUIDITY + VOLUME DATA CONTEXT
    this.streamManager.on('buySignal', async ({ token, signal }: { token: any; signal: any }) => {
      // Get updated token symbol for display
      const tokenData = await db('tokens').where('address', token.address).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : token.address.substring(0, 8) + '...';
      
      // Enhanced logging with liquidity + volume context
      logger.info(`💰 Buy signal for ${displaySymbol}: ${signal.reason}`, {
        marketCap: signal.marketCap,
        liquidity: signal.liquidity,
        holders: signal.holders,
        concentration: signal.top10Percent + '%',
        solsniffer: signal.solsnifferScore,
        // Liquidity quality context
        liquidityGrade: signal.liquidityQualityScore?.grade,
        liquidityMomentum: signal.liquidityGrowthMetrics?.momentum,
        riskLevel: signal.riskLevel,
        confidence: signal.confidence?.toFixed(2)
      });
      
      // Broadcast to WebSocket clients with enhanced context
      if (this.wsService) {
        this.wsService.broadcast('buySignal', { 
          token: tokenData || token, 
          signal: {
            ...signal,
            holderData: {
              total: tokenData?.holders,
              top10Concentration: tokenData?.top_10_percent,
              top25Concentration: tokenData?.top_25_percent,
              lastUpdated: tokenData?.holder_last_updated
            },
            // Enhanced liquidity context
            liquidityContext: {
              qualityGrade: signal.liquidityQualityScore?.grade,
              qualityScore: signal.liquidityQualityScore?.overallScore,
              tradingSuitability: signal.liquidityQualityScore?.tradingSuitability,
              momentum: signal.liquidityGrowthMetrics?.momentum,
              growthRate1h: signal.liquidityGrowthMetrics?.growthRate1h,
              accelerating: signal.liquidityGrowthMetrics?.accelerating
            }
          }
        });
      }
      
      // Could trigger automated trading here
    });

    // Handle category changes - queue liquidity + volume analysis for new AIM tokens
    this.streamManager.on('categoryChanged', async (data: any) => {
      // When a token moves to AIM category, prioritize all analytics
      if (data.toCategory === 'AIM') {
        logger.info(`🎯 Token moved to AIM: ${data.tokenAddress} - prioritizing all analytics`);
        HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(data.tokenAddress, 'HIGH');
        
        // Calculate initial liquidity quality for AIM tokens
        setTimeout(async () => {
          try {
            const qualityScore = await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(data.tokenAddress);
            if (qualityScore.tradingSuitability === 'EXCELLENT' || qualityScore.tradingSuitability === 'GOOD') {
              logger.info(`💎 New AIM token has ${qualityScore.tradingSuitability} liquidity quality: ${data.tokenAddress.substring(0,8)}...`);
              
              if (this.wsService) {
                this.wsService.broadcast('newAimHighQuality', {
                  tokenAddress: data.tokenAddress,
                  qualityScore: qualityScore,
                  category: 'AIM'
                });
              }
            }
          } catch (error) {
            logger.error('Error calculating liquidity quality for new AIM token:', error);
          }
        }, 10000); // After 10 seconds to allow price data to accumulate

        // NEW V4.27: Initialize volume analytics for new AIM tokens
        setTimeout(async () => {
          try {
            await VOLUME_ANALYTICS_SERVICE.calculateVolumeMetrics(data.tokenAddress, '1h');
            logger.info(`📊 Volume analytics initialized for new AIM token: ${data.tokenAddress.substring(0,8)}...`);
          } catch (error) {
            logger.error('Error initializing volume analytics for new AIM token:', error);
          }
        }, 15000); // After 15 seconds to allow transaction data to accumulate
      }
    });
    
    // Handle price movements - ENHANCED WITH LIQUIDITY + VOLUME REFRESH LOGIC
    this.streamManager.on('pumpDetected', async (data: any) => {
      // Get token symbol for better logging
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🚀 PUMP: ${displaySymbol} +${data.priceChange.toFixed(1)}% | $${data.marketCap.toFixed(0)} MC`);

      // For significant pumps, refresh all analytics
      if (data.priceChange > 20 && tokenData?.category === 'AIM') {
        logger.info(`📊 Significant pump detected - refreshing all analytics for ${displaySymbol}`);
        HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(data.tokenAddress, 'HIGH');
        
        // Check if pump created liquidity milestones
        setTimeout(async () => {
          try {
            const currentTokenData = await db('tokens').where('address', data.tokenAddress).first();
            if (currentTokenData) {
              await LIQUIDITY_MILESTONE_ALERTS.checkMilestones(data.tokenAddress, {
                liquidity_usd: currentTokenData.liquidity * await this.getCurrentSolPrice(),
                real_sol_reserves: currentTokenData.liquidity * 1e9, // Convert to lamports
                timestamp: new Date()
              });
            }
          } catch (error) {
            logger.error('Error checking liquidity milestones after pump:', error);
          }
        }, 5000);

        // NEW V4.27: Trigger volume analytics recalculation after pump
        setTimeout(async () => {
          try {
            const volumeMetrics = await VOLUME_ANALYTICS_SERVICE.calculateVolumeMetrics(data.tokenAddress, '1h');
            if (volumeMetrics) {
              await VOLUME_ANALYTICS_SERVICE.checkVolumeAlerts(data.tokenAddress, volumeMetrics);
            }
          } catch (error) {
            logger.error('Error checking volume metrics after pump:', error);
          }
        }, 7000);
      }
      
      if (this.wsService) {
        this.wsService.broadcast('pumpDetected', { ...data, symbol: displaySymbol });
      }
    });
    
    this.streamManager.on('dumpDetected', async (data: any) => {
      // Get token symbol for better logging
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.warn(`📉 DUMP: ${displaySymbol} ${data.priceChange.toFixed(1)}% | $${data.marketCap.toFixed(0)} MC`);
      
      if (this.wsService) {
        this.wsService.broadcast('dumpDetected', { ...data, symbol: displaySymbol });
      }
    });
    
    // Handle graduation events
    this.streamManager.on('nearGraduation', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🎓 NEAR GRADUATION: ${displaySymbol} ${data.progress.toFixed(1)}% complete`);
      
      if (this.wsService) {
        this.wsService.broadcast('nearGraduation', { ...data, symbol: displaySymbol });
      }
    });
    
    this.streamManager.on('tokenGraduated', async (data: any) => {
      const tokenData = await db('tokens').where('address', data.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : data.tokenAddress.substring(0, 8) + '...';
      
      logger.info(`🎓 GRADUATED: ${displaySymbol} → Raydium`);
      
      if (this.wsService) {
        this.wsService.broadcast('tokenGraduated', { ...data, symbol: displaySymbol });
      }
    });
    
    // Handle errors
    this.streamManager.on('error', (error: Error) => {
      logger.error('Stream manager error:', error);
    });
    
    // Handle connection events
    this.streamManager.on('connected', () => {
      logger.info('✅ gRPC stream connected');
    });
    
    this.streamManager.on('disconnected', () => {
      logger.warn('⚠️ gRPC stream disconnected');
    });
  }
  
  async start(): Promise<void> {
    logger.info('🚀 Starting gRPC Stream Application v4.27 with Enhanced Liquidity + Volume Analytics...');
    
    try {
      // Initialize services
      await this.initializeServices();
      
      // Start the stream manager
      await this.streamManager.start();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('✅ gRPC Stream Application v4.27 started successfully');
      
    } catch (error) {
      logger.error('Failed to start application:', error);
      throw error;
    }
  }
  
  private async initializeServices(): Promise<void> {
    // Test database connection
    const dbTest = await db.raw('SELECT NOW()');
    logger.info('✅ Database connected:', dbTest.rows[0].now);
    
    // Check TimescaleDB
    const tsCheck = await db.raw(`
      SELECT default_version, installed_version
      FROM pg_available_extensions
      WHERE name = 'timescaledb'
    `);
    logger.info('✅ TimescaleDB version:', tsCheck.rows[0]?.installed_version || 'Not installed');

    // Check holder analytics columns
    const holderColumnsCheck = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('top_25_percent', 'holder_distribution', 'holder_data_source', 'holder_last_updated')
    `);
    const hasHolderColumns = holderColumnsCheck.rows.length === 4;
    logger.info(`✅ Holder analytics columns: ${hasHolderColumns ? 'Present' : 'Missing - run migration'}`);

    // Check liquidity analytics tables
    const liquidityTablesCheck = await db.raw(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('liquidity_milestone_alerts', 'liquidity_growth_snapshots', 'buy_evaluations')
    `);
    logger.info(`✅ Liquidity analytics tables: ${liquidityTablesCheck.rows.length}/3 present`);

    // NEW V4.27: Check volume analytics tables
    const volumeTablesCheck = await db.raw(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('volume_alerts')
    `);
    logger.info(`✅ Volume analytics tables: ${volumeTablesCheck.rows.length}/1 present`);
    
    // Initialize SOL price service
    await SOL_PRICE_SERVICE.initialize();
    logger.info('✅ SOL price service initialized');
    
    // Initialize Shyft metadata service
    logger.info('✅ Shyft metadata service initialized');

    // Initialize holder analytics service
    await HOLDER_ANALYTICS_SERVICE.start();
    logger.info('✅ Holder analytics service initialized');

    // Initialize enhanced liquidity services
    // Note: These are singletons that initialize automatically
    logger.info('✅ Liquidity growth tracker initialized');
    logger.info('✅ Liquidity quality scorer initialized');
    logger.info('✅ Liquidity milestone alerts initialized');

    // NEW V4.27: Initialize Volume Analytics Service
    await VOLUME_ANALYTICS_SERVICE.start();
    logger.info('✅ Volume Analytics Service initialized');
    
    // Fix missing metadata on startup (after delay)
    setTimeout(async () => {
      try {
        logger.info('🔧 Starting initial metadata fix...');
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(100);
        logger.info(`✅ Fixed metadata for ${fixed} tokens on startup`);
      } catch (error) {
        logger.error('Error during startup metadata fix:', error);
      }
    }, 30000); // After 30 seconds

    // Queue high-priority tokens for holder analysis
    setTimeout(async () => {
      try {
        logger.info('📊 Starting initial holder analytics...');
        await HOLDER_ANALYTICS_SERVICE.queueTokensByCategory();
        logger.info('✅ Queued tokens for initial holder analysis');
      } catch (error) {
        logger.error('Error during startup holder analysis:', error);
      }
    }, 45000); // After 45 seconds

    // Initialize liquidity analytics for existing AIM tokens
    setTimeout(async () => {
      try {
        logger.info('💎 Starting initial liquidity analytics...');
        const aimTokens = await db('tokens')
          .where('category', 'AIM')
          .where('market_cap', '>', 35000)
          .limit(20)
          .pluck('address');
        
        for (const tokenAddress of aimTokens) {
          try {
            await LIQUIDITY_GROWTH_TRACKER.getGrowthMetrics(tokenAddress);
            await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(tokenAddress);
          } catch (error) {
            logger.debug(`Error calculating initial liquidity metrics for ${tokenAddress}:`, error);
          }
        }
        logger.info(`✅ Calculated initial liquidity metrics for ${aimTokens.length} AIM tokens`);
      } catch (error) {
        logger.error('Error during startup liquidity analytics:', error);
      }
    }, 60000); // After 60 seconds

    // NEW V4.27: Initialize volume analytics for existing high-activity tokens
    setTimeout(async () => {
      try {
        logger.info('📈 Starting initial volume analytics...');
        const highActivityTokens = await db('tokens')
          .whereIn('category', ['MEDIUM', 'HIGH', 'AIM'])
          .where('last_price_update', '>', new Date(Date.now() - 30 * 60 * 1000)) // Updated in last 30 minutes
          .orderBy('market_cap', 'desc')
          .limit(25)
          .pluck('address');
          
        for (const tokenAddress of highActivityTokens) {
          try {
            await VOLUME_ANALYTICS_SERVICE.calculateVolumeMetrics(tokenAddress, '1h');
          } catch (error) {
            logger.debug(`Error calculating initial volume metrics for ${tokenAddress}:`, error);
          }
        }
        logger.info(`✅ Calculated initial volume metrics for ${highActivityTokens.length} high-activity tokens`);
      } catch (error) {
        logger.error('Error during startup volume analytics:', error);
      }
    }, 75000); // After 75 seconds (after other services)
    
    // Initialize WebSocket service if enabled
    if (config.WEBSOCKET_ENABLED) {
      this.wsService = new WebSocketService(config.WEBSOCKET_PORT || 8080);
      await this.wsService.start();
      logger.info('✅ WebSocket service started');
    }
  }
  
  private startPeriodicTasks(): void {
    // ENHANCED: Stats display with all analytics
    this.statsInterval = setInterval(async () => {
      const stats = this.streamManager.getStats();
      const metadataStats = HELIUS_METADATA_SERVICE.getStats();
      const holderStats = HOLDER_ANALYTICS_SERVICE.getStats();
      const liquidityGrowthStats = LIQUIDITY_GROWTH_TRACKER.getSummaryStats();
      const liquidityAlertsStats = LIQUIDITY_MILESTONE_ALERTS.getAlertStats();
      // NEW V4.27: Get volume analytics stats
      const volumeStats = VOLUME_ANALYTICS_SERVICE.getStats();

      // Get holder analytics summary
      const holderSummary = await db.raw('SELECT * FROM get_holder_analytics_stats()');
      
      logger.info('📊 Stream Statistics:', {
        pricesProcessed: stats.pricesProcessed,
        transactionsProcessed: stats.transactionsProcessed,
        newTokensDiscovered: stats.newTokensDiscovered,
        buysDetected: stats.buysDetected,
        sellsDetected: stats.sellsDetected,
        errors: stats.errors,
        buffers: stats.bufferSizes,
        lastFlush: stats.lastFlush,
        metadata: {
          processing: metadataStats.processingQueue,
          retrying: metadataStats.retryQueue,
          requestDelay: metadataStats.requestDelay
        },
        holderAnalytics: {
          processing: holderStats.processingQueue,
          retrying: holderStats.retryQueue,
          requestDelay: holderStats.requestDelay
        },
        liquidityAnalytics: {
          growth: liquidityGrowthStats,
          alerts: liquidityAlertsStats
        },
        // NEW V4.27: Volume analytics stats
        volumeAnalytics: volumeStats
      });

      // NEW V4.27: Log volume analytics summary
      if (volumeStats.tokensTracked > 0) {
        logger.info('📈 Volume Analytics Summary:', {
          tokensTracked: volumeStats.tokensTracked,
          alertsTriggered: volumeStats.alertsTriggered,
          totalCalculations: volumeStats.totalCalculations,
          processingErrors: volumeStats.processingErrors,
          lastUpdateTime: volumeStats.lastUpdateTime
        });
      }

      // Log liquidity analytics summary
      if (liquidityGrowthStats.totalTokens > 0) {
        logger.info('💎 Liquidity Analytics Summary:', {
          trackedTokens: liquidityGrowthStats.totalTokens,
          highMomentum: liquidityGrowthStats.highMomentum,
          accelerating: liquidityGrowthStats.accelerating,
          topGrowers: liquidityGrowthStats.topGrowers
        });
      }

      // Log holder analytics summary
      if (holderSummary.rows.length > 0) {
        logger.info('📊 Holder Analytics Summary:', holderSummary.rows);
      }
      
      // Broadcast stats to WebSocket clients
      if (this.wsService) {
        this.wsService.broadcast('stats', {
          ...stats,
          metadata: metadataStats,
          holderAnalytics: holderStats,
          holderSummary: holderSummary.rows,
          liquidityAnalytics: {
            growth: liquidityGrowthStats,
            alerts: liquidityAlertsStats
          },
          // NEW V4.27: Include volume analytics
          volumeAnalytics: volumeStats
        });
      }
    }, 30000); // Every 30 seconds
    
    // Periodic metadata fixing (every 15 minutes)
    this.metadataFixInterval = setInterval(async () => {
      try {
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(25);
        if (fixed > 0) {
          logger.info(`🔄 Periodic metadata fix: ${fixed} tokens updated`);
        }
      } catch (error) {
        logger.error('Error during periodic metadata fix:', error);
      }
    }, 15 * 60 * 1000); // Every 15 minutes

    // Periodic holder analytics (every 3 minutes for AIM tokens)
    this.holderAnalyticsInterval = setInterval(async () => {
      try {
        await HOLDER_ANALYTICS_SERVICE.queueTokensByCategory();
        logger.info('🔄 Periodic holder analytics refresh queued');
      } catch (error) {
        logger.error('Error during periodic holder analytics:', error);
      }
    }, 3 * 60 * 1000); // Every 3 minutes

    // Periodic liquidity growth tracking (every 2 minutes)
    this.liquidityGrowthInterval = setInterval(async () => {
      try {
        // Get high-activity AIM tokens for growth tracking
        const activeTokens = await db('tokens')
          .where('category', 'AIM')
          .where('last_price_update', '>', new Date(Date.now() - 10 * 60 * 1000)) // Updated in last 10 minutes
          .orderBy('market_cap', 'desc')
          .limit(15)
          .pluck('address');
        
        if (activeTokens.length > 0) {
          const growthResults = await LIQUIDITY_GROWTH_TRACKER.batchCalculateGrowthRates(activeTokens);
          const highMomentumTokens = Array.from(growthResults.values())
            .filter(metrics => metrics.momentum === 'HIGH' && metrics.accelerating);
          
          if (highMomentumTokens.length > 0) {
            logger.info(`🚀 Found ${highMomentumTokens.length} tokens with high liquidity momentum`);
          }
        }
      } catch (error) {
        logger.error('Error during periodic liquidity growth tracking:', error);
      }
    }, 2 * 60 * 1000); // Every 2 minutes

    // Periodic liquidity quality assessment for AIM tokens (every 5 minutes)
    this.liquidityQualityInterval = setInterval(async () => {
      try {
        // Get AIM tokens that haven't been quality-assessed recently
        const tokensToAssess = await db('tokens')
          .where('category', 'AIM')
          .where('market_cap', '>', 35000)
          .orderBy('market_cap', 'desc')
          .limit(10)
          .pluck('address');
        
        for (const tokenAddress of tokensToAssess) {
          try {
            const qualityScore = await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(tokenAddress);
            
            // Log excellent quality tokens
            if (qualityScore.tradingSuitability === 'EXCELLENT') {
              const tokenData = await db('tokens').where('address', tokenAddress).first();
              const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
                ? tokenData.symbol
                : tokenAddress.substring(0, 8) + '...';
              
              logger.info(`💎 EXCELLENT liquidity quality detected: ${displaySymbol} - Grade: ${qualityScore.grade}`);
              
              // Broadcast high-quality discovery
              if (this.wsService) {
                this.wsService.broadcast('excellentLiquidityDetected', {
                  tokenAddress,
                  symbol: displaySymbol,
                  qualityScore
                });
              }
            }
          } catch (error) {
            logger.debug(`Error assessing liquidity quality for ${tokenAddress}:`, error);
          }
          
          // Small delay between assessments
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.error('Error during periodic liquidity quality assessment:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // NEW V4.27: Volume analytics summary (every 10 minutes)
    this.volumeAnalyticsInterval = setInterval(async () => {
      try {
        // Get volume leaderboard for different timeframes
        const leaderboard1h = await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard('1h');
        const leaderboard24h = await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard('24h');
        
        if (leaderboard1h.length > 0) {
          logger.info('📈 TOP VOLUME PERFORMERS (1h):');
          for (let i = 0; i < Math.min(5, leaderboard1h.length); i++) {
            const metrics = leaderboard1h[i];
            const tokenData = await db('tokens').where('address', metrics.tokenAddress).first();
            const symbol = tokenData?.symbol || metrics.tokenAddress.substring(0, 8) + '...';
            logger.info(`   ${i + 1}. ${symbol} | $${metrics.totalVolumeUsd.toFixed(0)} | ${metrics.totalTransactions} txs | ${metrics.buyVolumeRatio.toFixed(1)}% buys`);
          }
        }

        // Get recent high-severity alerts
        const recentAlerts = await VOLUME_ANALYTICS_SERVICE.getRecentAlerts(10, 'HIGH');
        if (recentAlerts.length > 0) {
          logger.info(`🚨 ${recentAlerts.length} HIGH-SEVERITY volume alerts in recent activity`);
        }

        // Broadcast volume summary to WebSocket clients
        if (this.wsService) {
          this.wsService.broadcast('volumeAnalyticsSummary', {
            leaderboard1h: leaderboard1h.slice(0, 10),
            leaderboard24h: leaderboard24h.slice(0, 10),
            recentHighAlerts: recentAlerts,
            timestamp: new Date()
          });
        }

      } catch (error) {
        logger.error('Error in periodic volume analytics summary:', error);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
    
    // ENHANCED: Health check with all services
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        
        if (!health.healthy) {
          logger.error('❌ Health check failed:', health);
          
          // Attempt recovery
          if (!health.grpcConnected) {
            logger.info('Attempting to reconnect gRPC...');
          }

          // Restart holder analytics if unhealthy
          if (!health.holderAnalyticsHealthy) {
            logger.info('Restarting holder analytics service...');
            try {
              await HOLDER_ANALYTICS_SERVICE.stop();
              await HOLDER_ANALYTICS_SERVICE.start();
            } catch (error) {
              logger.error('Failed to restart holder analytics service:', error);
            }
          }

          // Clear old liquidity data if memory issues detected
          if (!health.liquidityAnalyticsHealthy) {
            logger.info('Clearing old liquidity analytics data...');
            try {
              LIQUIDITY_MILESTONE_ALERTS.clearOldHistory(24); // Clear data older than 24 hours
            } catch (error) {
              logger.error('Failed to clear old liquidity data:', error);
            }
          }

          // NEW V4.27: Handle volume analytics health issues
          if (!health.volumeAnalyticsHealthy) {
            logger.info('Restarting volume analytics service...');
            try {
              await VOLUME_ANALYTICS_SERVICE.stop();
              await VOLUME_ANALYTICS_SERVICE.start();
            } catch (error) {
              logger.error('Failed to restart volume analytics service:', error);
            }
          }
        }
      } catch (error) {
        logger.error('Health check error:', error);
      }
    }, 60000); // Every minute
  }
  
  private async checkHealth(): Promise<any> {
    const stats = this.streamManager.getStats();
    const metadataStats = HELIUS_METADATA_SERVICE.getStats();
    const holderStats = HOLDER_ANALYTICS_SERVICE.getStats();
    const liquidityGrowthStats = LIQUIDITY_GROWTH_TRACKER.getSummaryStats();
    const liquidityAlertsStats = LIQUIDITY_MILESTONE_ALERTS.getAlertStats();
    // NEW V4.27: Check volume analytics health
    const volumeStats = VOLUME_ANALYTICS_SERVICE.getStats();
    
    // Check database
    let dbHealthy = true;
    try {
      await db.raw('SELECT 1');
    } catch (error) {
      dbHealthy = false;
    }
    
    // Check data freshness
    const timeSinceLastFlush = Date.now() - stats.lastFlush.getTime();
    const dataFresh = timeSinceLastFlush < 60000; // Less than 1 minute
    
    // Check metadata service health
    const metadataHealthy = metadataStats.processingQueue < 100 && metadataStats.retryQueue < 50;

    // Check holder analytics service health
    const holderAnalyticsHealthy = holderStats.processingQueue < 50 && holderStats.retryQueue < 25;

    // Check liquidity analytics health
    const liquidityAnalyticsHealthy = 
      liquidityGrowthStats.totalTokens < 1000 && // Reasonable memory usage
      liquidityAlertsStats.trackedTokens < 500;   // Reasonable alert tracking

    // NEW V4.27: Check volume analytics health
    const volumeAnalyticsHealthy = 
      volumeStats.processingErrors < 10 && // Reasonable error count
      volumeStats.isRunning &&
      volumeStats.tokensTracked < 1000; // Reasonable memory usage
    
    const healthy = dbHealthy && stats.grpcConnected && dataFresh && metadataHealthy && 
                   holderAnalyticsHealthy && liquidityAnalyticsHealthy && volumeAnalyticsHealthy;
    
    return {
      healthy,
      dbHealthy,
      grpcConnected: stats.grpcConnected,
      dataFresh,
      metadataHealthy,
      holderAnalyticsHealthy,
      liquidityAnalyticsHealthy,
      volumeAnalyticsHealthy, // NEW V4.27
      timeSinceLastFlush,
      errors: stats.errors,
      metadata: metadataStats,
      holderAnalytics: holderStats,
      liquidityAnalytics: {
        growth: liquidityGrowthStats,
        alerts: liquidityAlertsStats
      },
      volumeAnalytics: volumeStats // NEW V4.27
    };
  }

  /**
   * Helper to get current SOL price
   */
  private async getCurrentSolPrice(): Promise<number> {
    try {
      const solPrice = await db('sol_price_history')
        .orderBy('timestamp', 'desc')
        .first();
      return solPrice?.price || 100; // Default fallback
    } catch (error) {
      return 100; // Default fallback
    }
  }
  
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      try {
        // Stop periodic tasks
        if (this.statsInterval) {
          clearInterval(this.statsInterval);
        }
        
        if (this.healthCheckInterval) {
          clearInterval(this.healthCheckInterval);
        }
        
        if (this.metadataFixInterval) {
          clearInterval(this.metadataFixInterval);
        }

        if (this.holderAnalyticsInterval) {
          clearInterval(this.holderAnalyticsInterval);
        }

        if (this.liquidityGrowthInterval) {
          clearInterval(this.liquidityGrowthInterval);
        }

        if (this.liquidityQualityInterval) {
          clearInterval(this.liquidityQualityInterval);
        }

        // NEW V4.27: Stop volume analytics interval
        if (this.volumeAnalyticsInterval) {
          clearInterval(this.volumeAnalyticsInterval);
        }
        
        // Stop stream manager
        await this.streamManager.stop();

        // Stop holder analytics service
        await HOLDER_ANALYTICS_SERVICE.stop();

        // NEW V4.27: Stop volume analytics service
        await VOLUME_ANALYTICS_SERVICE.stop();
        
        // Stop WebSocket service
        if (this.wsService) {
          await this.wsService.stop();
        }
        
        // Close database pool
        await db.destroy();
        
        logger.info('✅ Shutdown complete');
        process.exit(0);
        
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }
  
  // Method to manually trigger metadata fix
  async fixMissingMetadata(limit: number = 50): Promise<number> {
    try {
      logger.info(`🔧 Manually triggering metadata fix for ${limit} tokens...`);
      const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(limit);
      logger.info(`✅ Manual metadata fix complete: ${fixed} tokens updated`);
      return fixed;
    } catch (error) {
      logger.error('Error during manual metadata fix:', error);
      return 0;
    }
  }

  // Enhanced method to manually trigger holder analytics
  async updateHoldersForToken(tokenAddress: string): Promise<any> {
    try {
      logger.info(`🔍 Manually updating holders for ${tokenAddress}`);
      const result = await HOLDER_ANALYTICS_SERVICE.forceUpdateHolders(tokenAddress);
      logger.info(`✅ Manual holder update complete for ${tokenAddress}`);
      return result;
    } catch (error) {
      logger.error('Error during manual holder update:', error);
      return null;
    }
  }

  // Manual liquidity analytics triggers
  async updateLiquidityMetrics(tokenAddress: string): Promise<any> {
    try {
      logger.info(`💎 Manually updating liquidity metrics for ${tokenAddress}`);
      
      const [growthMetrics, qualityScore] = await Promise.all([
        LIQUIDITY_GROWTH_TRACKER.calculateGrowthRate(tokenAddress),
        LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(tokenAddress)
      ]);
      
      logger.info(`✅ Manual liquidity update complete for ${tokenAddress}`);
      return { growthMetrics, qualityScore };
    } catch (error) {
      logger.error('Error during manual liquidity update:', error);
      return null;
    }
  }

  async checkLiquidityMilestones(tokenAddress: string): Promise<any> {
    try {
      logger.info(`🎯 Manually checking liquidity milestones for ${tokenAddress}`);
      
      const tokenData = await db('tokens').where('address', tokenAddress).first();
      if (!tokenData) {
        throw new Error('Token not found');
      }
      
      const milestones = await LIQUIDITY_MILESTONE_ALERTS.checkMilestones(tokenAddress, {
        liquidity_usd: tokenData.liquidity * await this.getCurrentSolPrice(),
        real_sol_reserves: tokenData.liquidity * 1e9,
        timestamp: new Date()
      });
      
      logger.info(`✅ Manual milestone check complete for ${tokenAddress}: ${milestones.length} alerts`);
      return milestones;
    } catch (error) {
      logger.error('Error during manual milestone check:', error);
      return [];
    }
  }

  // NEW V4.27: Manual volume analytics triggers
  async analyzeTokenVolume(tokenAddress: string): Promise<any> {
    try {
      logger.info(`📈 Manually analyzing volume for ${tokenAddress}`);
      const result = await VOLUME_ANALYTICS_SERVICE.analyzeToken(tokenAddress);
      logger.info(`✅ Manual volume analysis complete for ${tokenAddress}`);
      return result;
    } catch (error) {
      logger.error('Error during manual volume analysis:', error);
      return null;
    }
  }

  async getVolumeLeaderboard(timeWindow: '1h' | '4h' | '24h' = '1h'): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard(timeWindow);
    } catch (error) {
      logger.error('Error getting volume leaderboard:', error);
      return [];
    }
  }

  async getVolumeAlerts(limit: number = 50, severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.getRecentAlerts(limit, severity);
    } catch (error) {
      logger.error('Error getting volume alerts:', error);
      return [];
    }
  }

  async getVolumeSummary(category?: 'MEDIUM' | 'HIGH' | 'AIM'): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.getVolumeSummary(category);
    } catch (error) {
      logger.error('Error getting volume summary:', error);
      return [];
    }
  }
  
  // ENHANCED: Get comprehensive system status with volume analytics
  async getSystemStatus() {
    const streamStats = this.streamManager.getStats();
    const metadataStats = HELIUS_METADATA_SERVICE.getStats();
    const holderStats = HOLDER_ANALYTICS_SERVICE.getStats();
    const holderSummary = await HOLDER_ANALYTICS_SERVICE.getHolderSummary(10);
    const liquidityGrowthStats = LIQUIDITY_GROWTH_TRACKER.getSummaryStats();
    const liquidityAlertsStats = LIQUIDITY_MILESTONE_ALERTS.getAlertStats();
    // NEW V4.27: Get volume analytics status
    const volumeStats = VOLUME_ANALYTICS_SERVICE.getStats();
    
    return {
      stream: streamStats,
      metadata: metadataStats,
      holderAnalytics: holderStats,
      holderSummary: holderSummary,
      liquidityAnalytics: {
        growth: liquidityGrowthStats,
        alerts: liquidityAlertsStats
      },
      // NEW V4.27: Volume analytics status
      volumeAnalytics: volumeStats,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
  
  // Queue specific token for metadata fetch
  queueTokenForMetadata(tokenAddress: string): void {
    HELIUS_METADATA_SERVICE.queueTokenForMetadata(tokenAddress);
    logger.info(`📝 Manually queued metadata fetch: ${tokenAddress.substring(0, 8)}...`);
  }

  // Queue specific token for holder analysis
  queueTokenForHolderAnalysis(tokenAddress: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'): void {
    HOLDER_ANALYTICS_SERVICE.queueTokenForHolderAnalysis(tokenAddress, priority);
    logger.info(`📊 Manually queued holder analysis: ${tokenAddress.substring(0, 8)}... (${priority})`);
  }

  // Queue specific token for liquidity analytics
  queueTokenForLiquidityAnalysis(tokenAddress: string): void {
    // Queue for both growth tracking and quality scoring
    setTimeout(async () => {
      try {
        await LIQUIDITY_GROWTH_TRACKER.getGrowthMetrics(tokenAddress);
        await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(tokenAddress);
        logger.info(`💎 Liquidity analytics queued for: ${tokenAddress.substring(0, 8)}...`);
      } catch (error) {
        logger.error(`Error in liquidity analytics for ${tokenAddress}:`, error);
      }
    }, 1000);
  }

  // NEW V4.27: Queue specific token for volume analysis
  queueTokenForVolumeAnalysis(tokenAddress: string): void {
    setTimeout(async () => {
      try {
        await VOLUME_ANALYTICS_SERVICE.calculateVolumeMetrics(tokenAddress, '1h');
        logger.info(`📈 Volume analytics queued for: ${tokenAddress.substring(0, 8)}...`);
      } catch (error) {
        logger.error(`Error in volume analytics for ${tokenAddress}:`, error);
      }
    }, 1000);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new GrpcStreamApplication();
  
  app.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}