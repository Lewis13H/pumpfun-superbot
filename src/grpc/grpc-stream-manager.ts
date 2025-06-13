// src/grpc/grpc-stream-manager.ts - ENHANCED WITH LIQUIDITY + VOLUME ANALYTICS v4.27

import { YellowstoneGrpcClient, TokenPrice, TokenTransaction } from './yellowstone-grpc-client';
import { Knex } from 'knex';
import { logger } from '../utils/logger2';
import { config } from '../config';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
import { EnhancedYellowstoneClient } from './enhanced-yellowstone-client';
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');
import { EventEmitter } from 'events';

// Import enhanced liquidity services
import { LIQUIDITY_GROWTH_TRACKER } from '../services/liquidity-growth-tracker';
import { LIQUIDITY_QUALITY_SCORER } from '../services/liquidity-quality-scorer';
import { LIQUIDITY_MILESTONE_ALERTS } from '../services/liquidity-milestone-alerts';

// NEW V4.27: Import volume analytics service
import { VOLUME_ANALYTICS_SERVICE } from '../services/volume-analytics-service';

export interface StreamManagerConfig {
  grpcEndpoint: string;
  grpcToken: string;
  batchSize?: number;
  flushInterval?: number;
  priceChangeInterval?: number;
}

interface BatchBuffers {
  prices: TokenPrice[];
  transactions: TokenTransaction[];
  newTokens: Map<string, NewToken>;
}

interface NewToken {
  address: string;
  symbol: string;
  name: string;
  bondingCurve?: string;
  creator: string;
  createdAt: Date;
  discoverySignature: string;
  discoverySlot: number;
}

export class GrpcStreamManager extends EventEmitter {
  private grpcClient: YellowstoneGrpcClient;
  private db: Knex;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private solPriceUsd: number = 100;
  
  private buffers: BatchBuffers = {
    prices: [],
    transactions: [],
    newTokens: new Map()
  };
  
  private stats = {
    pricesProcessed: 0,
    transactionsProcessed: 0,
    newTokensDiscovered: 0,
    buysDetected: 0,
    sellsDetected: 0,
    errors: 0,
    lastFlush: new Date(),
    // Liquidity analytics stats
    liquidityMilestonesTriggered: 0,
    highQualityLiquidityDetected: 0,
    liquidityMomentumEvents: 0
  };
  
  private flushTimer?: NodeJS.Timeout;
  private priceChangeTimer?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;
  private isRunning = false;
  
  // Liquidity tracking state
  private lastLiquidityValues = new Map<string, number>(); // token -> last known liquidity USD
  private liquidityCheckThrottles = new Map<string, number>(); // token -> last check timestamp
  
  private readonly config: Required<StreamManagerConfig>;
  
  constructor(
    config: StreamManagerConfig,
    db: Knex,
    categoryManager: CategoryManager,
    buySignalEvaluator: BuySignalEvaluator
  ) {
    super();
    
    this.config = {
      batchSize: 1000,
      flushInterval: 1000,
      priceChangeInterval: 5 * 60 * 1000,
      ...config
    };
    
    this.db = db;
    this.categoryManager = categoryManager;
    this.buySignalEvaluator = buySignalEvaluator;
    
    this.grpcClient = new YellowstoneGrpcClient({
      endpoint: config.grpcEndpoint,
      token: config.grpcToken
    });
  
    this.setupEventHandlers();
    this.setupLiquidityEventHandlers();
    this.setupVolumeAnalyticsEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Handle price updates
    this.grpcClient.on('priceUpdate', async (price: TokenPrice) => {
      await this.handlePriceUpdate(price);
    });
    
    // Handle transactions
    this.grpcClient.on('transaction', async (tx: TokenTransaction) => {
      await this.handleTransaction(tx);
    });
    
    // Handle new tokens
    this.grpcClient.on('tokenCreated', async (tx: TokenTransaction) => {
      await this.handleNewToken(tx);
      
      // Queue for Helius metadata fetch
      HELIUS_METADATA_SERVICE.queueTokenForMetadata(tx.tokenAddress);
      logger.info(`📝 Queued metadata fetch for: ${tx.tokenAddress.substring(0, 8)}...`);
    });
    
    // Handle errors
    this.grpcClient.on('error', (error: Error) => {
      logger.error('gRPC client error:', error.message);
      this.stats.errors++;
      this.emit('error', error);
    });
    
    // Handle connection events
    this.grpcClient.on('connected', () => {
      logger.info('✅ gRPC stream connected');
      this.emit('connected');
    });
    
    this.grpcClient.on('disconnected', () => {
      logger.warn('⚠️ gRPC stream disconnected');
      this.emit('disconnected');
    });
  }

  /**
   * Setup liquidity event handlers
   */
  private setupLiquidityEventHandlers(): void {
    // Handle milestone alerts
    LIQUIDITY_MILESTONE_ALERTS.on('milestoneAlert', (alert: any) => {
      this.stats.liquidityMilestonesTriggered++;
      this.emit('liquidityMilestone', alert);
    });

    LIQUIDITY_MILESTONE_ALERTS.on('criticalMilestone', (alert: any) => {
      this.stats.liquidityMilestonesTriggered++;
      this.emit('criticalLiquidityMilestone', alert);
    });

    LIQUIDITY_MILESTONE_ALERTS.on('highMilestone', (alert: any) => {
      this.stats.liquidityMilestonesTriggered++;
      this.emit('highLiquidityMilestone', alert);
    });
  }

  /**
   * NEW V4.27: Setup volume analytics event handlers
   */
  private setupVolumeAnalyticsEventHandlers(): void {
    // Handle volume alerts
    VOLUME_ANALYTICS_SERVICE.on('volumeAlert', async (alert: any) => {
      const tokenData = await this.db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      // Enhanced logging based on severity
      if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
        logger.info(`🚨 CRITICAL VOLUME ALERT: ${displaySymbol} - ${alert.message}`);
      } else {
        logger.info(`📊 Volume Alert: ${displaySymbol} - ${alert.message}`);
      }

      // Broadcast to WebSocket clients
      this.emit('volumeAlert', {
        ...alert,
        symbol: displaySymbol
      });
    });

    // Handle critical volume alerts with special processing
    VOLUME_ANALYTICS_SERVICE.on('criticalVolumeAlert', async (alert: any) => {
      const tokenData = await this.db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`🚨 CRITICAL VOLUME EVENT: ${displaySymbol} - ${alert.message}`);

      // For AIM tokens with critical volume alerts, trigger immediate buy signal evaluation
      if (tokenData?.category === 'AIM') {
        setTimeout(async () => {
          try {
            const evaluation = await this.buySignalEvaluator.evaluateToken(alert.tokenAddress);
            if (evaluation.passed) {
              logger.info(`🚨 VOLUME-TRIGGERED BUY SIGNAL: ${displaySymbol}`);
              
              this.emit('volumeTriggeredBuySignal', {
                token: tokenData,
                signal: evaluation,
                trigger: 'CRITICAL_VOLUME_ALERT',
                volumeAlert: alert
              });
            }
          } catch (error) {
            logger.error(`Error evaluating buy signal after critical volume alert:`, error);
          }
        }, 3000);
      }

      // Broadcast critical alert with priority
      this.emit('criticalVolumeAlert', {
        ...alert,
        symbol: displaySymbol,
        priority: 'CRITICAL'
      });
    });

    // Handle volume spikes
    VOLUME_ANALYTICS_SERVICE.on('volume_spike', async (alert: any) => {
      const tokenData = await this.db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`📈 VOLUME SPIKE: ${displaySymbol} - ${alert.details.percentageChange.toFixed(1)}% above average`);

      this.emit('volumeSpike', {
        ...alert,
        symbol: displaySymbol
      });
    });

    // Handle buy/sell imbalances
    VOLUME_ANALYTICS_SERVICE.on('buy_sell_imbalance', async (alert: any) => {
      const tokenData = await this.db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`⚖️ VOLUME IMBALANCE: ${displaySymbol} - ${alert.message}`);

      this.emit('volumeImbalance', {
        ...alert,
        symbol: displaySymbol
      });
    });

    // Handle unusual patterns
    VOLUME_ANALYTICS_SERVICE.on('unusual_pattern', async (alert: any) => {
      const tokenData = await this.db('tokens').where('address', alert.tokenAddress).first();
      const displaySymbol = tokenData?.symbol && tokenData.symbol !== 'LOADING...'
        ? tokenData.symbol
        : alert.tokenAddress.substring(0, 8) + '...';

      logger.info(`🔍 UNUSUAL PATTERN: ${displaySymbol} - ${alert.message}`);

      this.emit('unusualVolumePattern', {
        ...alert,
        symbol: displaySymbol
      });
    });
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Stream manager already running');
      return;
    }
    
    logger.info('🚀 Starting enhanced gRPC stream manager with liquidity + volume analytics...');
    
    try {
      // Test database connection
      await this.db.raw('SELECT NOW()');
      logger.info('✅ Database connection verified');
      
      // Get current SOL price if available
      try {
        const solPrice = await this.db('sol_price_history')
          .orderBy('timestamp', 'desc')
          .first();
        if (solPrice) {
          this.solPriceUsd = solPrice.price;
          this.grpcClient.setSolPrice(solPrice.price);
        }
      } catch (error) {
        logger.warn('Could not fetch SOL price, using default');
      }
      
      // Connect to gRPC
      await this.grpcClient.connect();
      
      // Start timers
      this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
      this.priceChangeTimer = setInterval(() => this.calculatePriceChanges(), this.config.priceChangeInterval);
      
      // Start Helius metadata batch fixing (after 30 seconds)
      setTimeout(async () => {
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(50);
        logger.info(`🔧 Fixed metadata for ${fixed} tokens on startup`);
      }, 30000);
      
      // Clean stats display every 2 minutes
      this.statsTimer = setInterval(() => {
        this.displayCleanStats();
      }, 120000);
      
      this.isRunning = true;
      
      logger.info('✅ Enhanced stream manager started successfully');
      this.emit('started');
      
    } catch (error) {
      logger.error('Failed to start stream manager:', error);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('🛑 Stopping stream manager...');
    
    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    if (this.priceChangeTimer) {
      clearInterval(this.priceChangeTimer);
      this.priceChangeTimer = undefined;
    }
    
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
    
    // Flush remaining data
    await this.flush();
    
    // Disconnect gRPC
    await this.grpcClient.disconnect();
    
    this.isRunning = false;
    
    logger.info('✅ Stream manager stopped');
    this.emit('stopped');
  }
  
  /**
   * ENHANCED: Handle price updates with liquidity analytics
   */
  private async handlePriceUpdate(price: TokenPrice): Promise<void> {
    try {
      if (!price.tokenAddress) {
        return;
      }
      
      // Determine category - returns null if below $8k
      const category = this.determineCategory(price.marketCap);

      // Don't process tokens below $8k market cap
      if (category === null) {
        logger.debug(`Ignoring token ${price.tokenAddress.substring(0, 8)}... with market cap $${price.marketCap.toFixed(0)} (below $8k threshold)`);
        return;
      }
    
       // Check if token exists in database
      const tokenExists = await this.db('tokens')
        .where('address', price.tokenAddress)
        .first();
    
      if (!tokenExists) {
        // Create token with determined category
        await this.db('tokens')
          .insert({
            address: price.tokenAddress,
            symbol: 'LOADING...',
            name: 'Loading...',
            category: category, // Use determined category, not 'NEW'
            current_price_usd: price.priceUsd,
            current_price_sol: price.priceSol,
            market_cap: price.marketCap,
            liquidity: price.liquidityUsd / this.solPriceUsd,
            curve_progress: price.curveProgress || 0,
            last_price_update: new Date(),
            created_at: new Date(),
            first_seen_above_8k: new Date() // Track when first seen above $8k
          })
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'market_cap', 'liquidity', 'curve_progress', 'last_price_update']);
        
        // Queue for metadata fetch
        HELIUS_METADATA_SERVICE.queueTokenForMetadata(price.tokenAddress);
      
      } else {
        // Update existing token
        await this.db('tokens')
          .where('address', price.tokenAddress)
          .update({
            current_price_usd: price.priceUsd,
            current_price_sol: price.priceSol,
            market_cap: price.marketCap,
            liquidity: price.liquidityUsd / this.solPriceUsd,
            curve_progress: price.curveProgress || 0,
            last_price_update: new Date(),
            price_update_count: this.db.raw('price_update_count + 1'),
            updated_at: new Date(),
            // Update first_seen_above_8k if this is the first time above $8k
            ...(tokenExists.market_cap < 8000 && price.marketCap >= 8000 && !tokenExists.first_seen_above_8k 
              ? { first_seen_above_8k: new Date() } 
             : {}),
            // Clear below_8k_since if token is back above $8k
            ...(price.marketCap >= 8000 && tokenExists.below_8k_since 
              ? { below_8k_since: null } 
              : {}),
            // Set below_8k_since if token drops below $8k
            ...(price.marketCap < 8000 && !tokenExists.below_8k_since 
              ? { below_8k_since: new Date() } 
              : {})
          });
      }
      
      // Add to buffer for time-series storage
      this.buffers.prices.push({
        ...price,
        curveProgress: price.curveProgress || 0,
        totalSupply: price.totalSupply || 0,
        isComplete: price.isComplete || false
      });
      
      this.stats.pricesProcessed++;
      
      // Enhanced liquidity tracking and analytics
      await this.handleLiquidityAnalytics(price, tokenExists);
      
      // Check category transitions
      if (tokenExists && category !== null) {
        const previousCategory = tokenExists.category;
        const newCategory = category;
        
        if (previousCategory && previousCategory !== newCategory) {
          await this.categoryManager.updateTokenCategory(price.tokenAddress, newCategory, price.marketCap);
          
          logger.info(`📊 CATEGORY: ${price.tokenAddress.substring(0, 8)}... ${previousCategory} → ${newCategory} ($${price.marketCap.toFixed(0)})`);
          
          await this.db('category_transitions').insert({
            token_address: price.tokenAddress,
            from_category: previousCategory,
            to_category: newCategory,
            market_cap_at_transition: price.marketCap,
            reason: 'market_cap_threshold',
            created_at: new Date()
          });

          // Emit category change event for liquidity analysis
          this.emit('categoryChanged', {
            tokenAddress: price.tokenAddress,
            fromCategory: previousCategory,
            toCategory: newCategory,
            marketCap: price.marketCap
          });
        }
      }
      
      // Check for buy signals on AIM tokens
      if (price.marketCap >= 35000 && price.marketCap <= 105000) {
        await this.evaluateBuySignal(price.tokenAddress, price);
      }
      
      // Flush if buffer is full
      if (this.buffers.prices.length >= this.config.batchSize) {
        await this.flush();
      }
      
    } catch (error: any) {
      logger.error('Error handling price update:', error?.message);
      this.stats.errors++;
    }
  }

  /**
   * Handle liquidity analytics for price updates
   */
  private async handleLiquidityAnalytics(price: TokenPrice, tokenData: any): Promise<void> {
    try {
      // Only process tokens with meaningful liquidity to avoid noise
      if (price.liquidityUsd < 1000) {
        return;
      }

      // Throttle liquidity checks to avoid overwhelming the system (max once per minute per token)
      const lastCheck = this.liquidityCheckThrottles.get(price.tokenAddress) || 0;
      const now = Date.now();
      if (now - lastCheck < 60000) { // 1 minute throttle
        return;
      }
      this.liquidityCheckThrottles.set(price.tokenAddress, now);

      // Get previous liquidity value for milestone detection
      const previousLiquidity = this.lastLiquidityValues.get(price.tokenAddress) || 0;
      this.lastLiquidityValues.set(price.tokenAddress, price.liquidityUsd);

      // 1. Check for liquidity milestones
      if (previousLiquidity > 0 && Math.abs(price.liquidityUsd - previousLiquidity) > 500) {
        try {
          const milestones = await LIQUIDITY_MILESTONE_ALERTS.checkMilestones(price.tokenAddress, {
            liquidity_usd: price.liquidityUsd,
            real_sol_reserves: price.realSolReserves || 0,
            timestamp: price.timestamp
          });

          // Emit milestone events
          for (const milestone of milestones) {
            if (milestone.actionable) {
              this.emit('actionableMilestone', milestone);
            }
          }
        } catch (error) {
          logger.debug(`Error checking liquidity milestones for ${price.tokenAddress}:`, error);
        }
      }

      // 2. Calculate liquidity quality for AIM tokens
      if (price.marketCap >= 35000 && price.marketCap <= 105000) {
        try {
          const qualityScore = await LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(price.tokenAddress);
          
          if (qualityScore.tradingSuitability === 'EXCELLENT' || qualityScore.tradingSuitability === 'GOOD') {
            this.stats.highQualityLiquidityDetected++;
            this.emit('highQualityLiquidity', {
              tokenAddress: price.tokenAddress,
              score: qualityScore.overallScore,
              grade: qualityScore.grade,
              suitability: qualityScore.tradingSuitability,
              liquidityUsd: price.liquidityUsd,
              marketCap: price.marketCap
            });
          }
        } catch (error) {
          logger.debug(`Error calculating liquidity quality for ${price.tokenAddress}:`, error);
        }
      }

      // 3. Track liquidity growth for high-activity tokens
      if (price.liquidityUsd > 5000) {
        try {
          const growthMetrics = await LIQUIDITY_GROWTH_TRACKER.getGrowthMetrics(
            price.tokenAddress,
            300000 // 5 minute cache
          );
          
          if (growthMetrics.momentum === 'HIGH' && growthMetrics.accelerating) {
            this.stats.liquidityMomentumEvents++;
            this.emit('liquidityMomentum', {
              tokenAddress: price.tokenAddress,
              growthRate1h: growthMetrics.growthRate1h,
              momentum: growthMetrics.momentum,
              accelerating: growthMetrics.accelerating,
              currentLiquidity: growthMetrics.currentLiquiditySol,
              message: `🚀 HIGH MOMENTUM: +${growthMetrics.growthRate1h.toFixed(1)} SOL/hour`
            });
          }
        } catch (error) {
          logger.debug(`Error calculating liquidity growth for ${price.tokenAddress}:`, error);
        }
      }

      // 4. Detect significant liquidity changes (pumps/dumps)
      if (previousLiquidity > 0) {
        const liquidityChange = ((price.liquidityUsd - previousLiquidity) / previousLiquidity) * 100;
        
        if (liquidityChange > 50 && price.liquidityUsd > 10000) {
          logger.info(`💰 LIQUIDITY PUMP: ${price.tokenAddress.substring(0,8)}... +${liquidityChange.toFixed(1)}% liquidity`);
          
          this.emit('liquidityPump', {
            tokenAddress: price.tokenAddress,
            liquidityChange,
            currentLiquidity: price.liquidityUsd,
            previousLiquidity
          });
        } else if (liquidityChange < -30 && previousLiquidity > 5000) {
          logger.warn(`📉 LIQUIDITY DUMP: ${price.tokenAddress.substring(0,8)}... ${liquidityChange.toFixed(1)}% liquidity`);
          
          this.emit('liquidityDump', {
            tokenAddress: price.tokenAddress,
            liquidityChange,
            currentLiquidity: price.liquidityUsd,
            previousLiquidity
          });
        }
      }

    } catch (error) {
      logger.debug(`Error in liquidity analytics for ${price.tokenAddress}:`, error);
    }
  }
  
  private determineCategory(marketCap: number): string | null {
    // Don't save tokens below $8k
    if (marketCap < 8000) return null;
  
    if (marketCap < 15000) return 'LOW';       // $8k - $15k (entry level)
    if (marketCap < 25000) return 'MEDIUM';    // $15k - $25k
    if (marketCap < 35000) return 'HIGH';      // $25k - $35k
    if (marketCap < 105000) return 'AIM';      // $35k - $105k (target for trading)
    return 'GRADUATED';                         // >$105k (graduated) - recorded but no trading
  }
  
  /**
   * ENHANCED: Handle transactions with volume analytics
   */
  private async handleTransaction(tx: TokenTransaction): Promise<void> {
    try {
      if (tx.tokenAddress === 'unknown') {
        return;
      }
      
      this.buffers.transactions.push(tx);
      this.stats.transactionsProcessed++;
      
      if (tx.type === 'buy') {
        this.stats.buysDetected++;
      } else if (tx.type === 'sell') {
        this.stats.sellsDetected++;
      } else if (tx.type === 'create') {
        // CREATE transactions are already counted in newTokensDiscovered
        // but we still want them in the transaction history
        logger.debug(`📝 CREATE transaction added to buffer: ${tx.tokenAddress?.substring(0, 8)}...`);
      }

      // NEW V4.27: Process transaction for volume analytics
      await this.processTransactionForVolumeAnalytics(tx);
      
      // Flush if buffer is full
      if (this.buffers.transactions.length >= this.config.batchSize) {
        await this.flush();
      }
      
    } catch (error: any) {
      logger.error('Error handling transaction:', error?.message);
      this.stats.errors++;
    }
  }

  /**
   * NEW V4.27: Process transaction for volume analytics
   */
  private async processTransactionForVolumeAnalytics(tx: TokenTransaction): Promise<void> {
    try {
      // Only process buy/sell transactions
      if (tx.type !== 'buy' && tx.type !== 'sell') {
        return;
      }

      // Get token data to check category
      const tokenData = await this.db('tokens')
        .where('address', tx.tokenAddress)
        .first();

      if (!tokenData) {
        return;
      }

      // Only track MEDIUM, HIGH, AIM tokens
      if (!['MEDIUM', 'HIGH', 'AIM'].includes(tokenData.category)) {
        return;
      }

      // Calculate USD value
      const solAmount = Number(tx.solAmount || 0) / 1e9; // Convert lamports to SOL
      const usdValue = solAmount * this.solPriceUsd;

      // Skip very small transactions to reduce noise
      if (usdValue < 10) {
        return;
      }

      // Send to volume analytics service
      await VOLUME_ANALYTICS_SERVICE.processTransaction({
        tokenAddress: tx.tokenAddress,
        type: tx.type,
        solAmount: solAmount,
        usdValue: usdValue,
        timestamp: tx.timestamp,
        category: tokenData.category
      });

    } catch (error) {
      logger.debug('Error processing transaction for volume analytics:', error);
    }
  }
  
  private async handleNewToken(tx: TokenTransaction): Promise<void> {
    try {
      if (!tx.tokenAddress) {
        return;
      }
      
      // Check if token already exists
      const exists = await this.db('tokens')
        .where('address', tx.tokenAddress)
        .first();
      
      if (exists) {
        return;
      }
      
      const newToken: NewToken = {
        address: tx.tokenAddress,
        symbol: 'LOADING...',
        name: 'Loading...',
        bondingCurve: tx.bondingCurve,
        creator: tx.userAddress,
        createdAt: tx.timestamp,
        discoverySignature: tx.signature,
        discoverySlot: tx.slot
      };
      
      // Insert token immediately with placeholder metadata
      try {
        await this.db('tokens')
          .insert({
            address: newToken.address,
            symbol: newToken.symbol,
            name: newToken.name,
            category: 'NEW',
            bonding_curve: newToken.bondingCurve || null,
            created_at: newToken.createdAt,
            discovery_signature: newToken.discoverySignature,
            discovery_slot: newToken.discoverySlot
          })
          .onConflict('address')
          .ignore();
        
        logger.info(`🆕 NEW TOKEN: ${tx.tokenAddress.substring(0, 8)}... | Metadata loading...`);
        this.stats.newTokensDiscovered++;
        
        // Initialize liquidity tracking for new token
        this.lastLiquidityValues.set(tx.tokenAddress, 0);
        
        this.emit('newToken', newToken);
        
      } catch (error: any) {
        logger.error(`Failed to insert token ${tx.tokenAddress}:`, error?.message);
        this.buffers.newTokens.set(tx.tokenAddress, newToken);
      }
      
    } catch (error: any) {
      logger.error('Error handling new token:', error?.message);
      this.stats.errors++;
    }
  }
  
  /**
   * ENHANCED: Buy signal evaluation with liquidity context
   */
  private async evaluateBuySignal(tokenAddress: string, price: TokenPrice): Promise<void> {
    try {
      const token = await this.db('tokens')
        .where('address', tokenAddress)
        .first();
      
      if (!token || token.buy_attempts >= 3) {
        return;
      }
      
      token.market_cap = price.marketCap;
      token.current_price_usd = price.priceUsd;
      token.liquidity = price.liquidityUsd / this.solPriceUsd;
      
      if (!token.holders || !token.top_10_percent || !token.solsniffer_score) {
        return;
      }
      
      const evaluation = await this.buySignalEvaluator.evaluateToken(token.address);
      
      if (evaluation && evaluation.passed) {
        logger.info(`🚨 BUY SIGNAL: ${tokenAddress.substring(0, 8)}... | Enhanced evaluation passed`, {
          confidence: evaluation.confidence?.toFixed(2),
          liquidityGrade: evaluation.liquidityQualityScore?.grade,
          riskLevel: evaluation.riskLevel
        });
        
        this.emit('buySignal', { 
          token, 
          evaluation,
          // Add enhanced context
          enhancedContext: {
            liquidityQuality: evaluation.liquidityQualityScore?.tradingSuitability,
            liquidityMomentum: evaluation.liquidityGrowthMetrics?.momentum,
            positionSizeRecommendation: evaluation.recommendedPosition
          }
        });
      }
      
    } catch (error: any) {
      // Silent fail for buy signal evaluation
      logger.debug(`Buy signal evaluation failed for ${tokenAddress}:`, error?.message);
    }
  }
  
  private async flush(): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 Starting flush with ${this.buffers.prices.length} prices, ${this.buffers.transactions.length} transactions, ${this.buffers.newTokens.size} new tokens`);
      
      await this.db.transaction(async (trx) => {
        if (this.buffers.newTokens.size > 0) {
          logger.info(`📝 Flushing ${this.buffers.newTokens.size} new tokens...`);
          await this.flushNewTokens(trx);
          logger.info(`✅ New tokens flushed successfully`);
        }
        
        if (this.buffers.prices.length > 0) {
          logger.info(`📈 Flushing ${this.buffers.prices.length} prices...`);
          await this.flushPrices(trx);
          logger.info(`✅ Prices flushed successfully`);
        }
        
        if (this.buffers.transactions.length > 0) {
          logger.info(`💰 Flushing ${this.buffers.transactions.length} transactions...`);
          await this.flushTransactions(trx);
          logger.info(`✅ Transactions flushed successfully`);
        }
      });
      
      const duration = Date.now() - startTime;
      logger.info(`✅ Flush completed successfully in ${duration}ms`);
      
      this.stats.lastFlush = new Date();
      this.emit('flushed', {
        prices: this.buffers.prices.length,
        transactions: this.buffers.transactions.length,
        newTokens: this.buffers.newTokens.size,
        duration
      });
      
      // Clear buffers
      this.buffers.prices = [];
      this.buffers.transactions = [];
      this.buffers.newTokens.clear();
      
    } catch (error: any) {
      logger.error('❌ DETAILED FLUSH ERROR:', {
        message: error?.message || 'No error message',
        code: error?.code || 'No error code',
        detail: error?.detail || 'No error detail',
        hint: error?.hint || 'No error hint',
        stack: error?.stack || 'No stack trace',
        bufferSizes: {
          prices: this.buffers.prices.length,
          transactions: this.buffers.transactions.length,
          newTokens: this.buffers.newTokens.size
        }
      });
      
      this.stats.errors++;
      
      // Clear buffers to prevent memory buildup
      this.buffers.prices = [];
      this.buffers.transactions = [];
      this.buffers.newTokens.clear();
    }
  }
  
  private async flushNewTokens(trx: Knex.Transaction): Promise<void> {
    const tokens = Array.from(this.buffers.newTokens.values());
    
    const insertData = tokens.map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      category: 'NEW',
      bonding_curve: token.bondingCurve || null,
      created_at: token.createdAt,
      discovery_signature: token.discoverySignature,
      discovery_slot: token.discoverySlot
    }));
    
    await trx('tokens')
      .insert(insertData)
      .onConflict('address')
      .ignore();
  }
  
  private async flushPrices(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.prices.length === 0) return;
    
    try {
      logger.info(`🔍 Processing ${this.buffers.prices.length} price updates...`);
      
      // Ensure all tokens exist in the database
      const uniqueTokenAddresses = [...new Set(this.buffers.prices.map(p => p.tokenAddress))];
      logger.info(`🎯 Found ${uniqueTokenAddresses.length} unique token addresses`);
      
      const existingTokens = await trx('tokens')
        .whereIn('address', uniqueTokenAddresses)
        .pluck('address');
      
      const existingTokenSet = new Set(existingTokens);
      const missingTokens = uniqueTokenAddresses.filter(addr => !existingTokenSet.has(addr));
      
      logger.info(`📊 Tokens: ${existingTokens.length} existing, ${missingTokens.length} missing`);
      
      // Insert any missing tokens with minimal data
      if (missingTokens.length > 0) {
        logger.info(`➕ Inserting ${missingTokens.length} missing tokens...`);
        
        const tokensToInsert = missingTokens.map(address => ({
          address,
          symbol: 'LOADING...',
          name: 'Loading...',
          category: 'NEW',
          created_at: new Date(),
          current_price_usd: this.buffers.prices.find(p => p.tokenAddress === address)?.priceUsd || 0,
          current_price_sol: this.buffers.prices.find(p => p.tokenAddress === address)?.priceSol || 0,
          market_cap: this.buffers.prices.find(p => p.tokenAddress === address)?.marketCap || 0,
          last_price_update: new Date()
        }));
        
        await trx('tokens')
          .insert(tokensToInsert)
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'market_cap', 'last_price_update']);
        
        logger.info(`✅ Missing tokens inserted successfully`);
      }
      
      // Insert price data
      logger.info(`📊 Preparing price data for time-series insertion...`);
      
      const rawInsertData = this.buffers.prices.map(price => ({
        token_address: price.tokenAddress,
        time: price.timestamp,
        price_usd: price.priceUsd,
        price_sol: price.priceSol,
        virtual_sol_reserves: price.virtualSolReserves?.toString() || '0',
        virtual_token_reserves: price.virtualTokenReserves?.toString() || '0',
        real_sol_reserves: price.realSolReserves?.toString() || '0',
        real_token_reserves: price.realTokenReserves?.toString() || '0',
        market_cap: price.marketCap,
        liquidity_usd: price.liquidityUsd,
        slot: price.slot,
        source: 'grpc'
      }));
      
      // CRITICAL: Deduplicate by (token_address, time) to avoid "cannot affect row a second time" error
      const deduplicatedData = new Map<string, any>();
      
      for (const record of rawInsertData) {
        const key = `${record.token_address}_${record.time.getTime()}`;
        
        // Keep the latest record for each (token_address, time) combination
        if (!deduplicatedData.has(key) || record.slot > (deduplicatedData.get(key)?.slot || 0)) {
          deduplicatedData.set(key, record);
        }
      }
      
      const insertData = Array.from(deduplicatedData.values());
      
      logger.info(`📊 Deduplicated: ${rawInsertData.length} → ${insertData.length} price records (removed ${rawInsertData.length - insertData.length} duplicates)`);
      
      if (insertData.length === 0) {
        logger.info(`⚠️ No price data to insert after deduplication`);
        return;
      }
      
      // Insert in batches
      const batchSize = 50; // Smaller batch size
      logger.info(`📦 Inserting ${insertData.length} prices in batches of ${batchSize}...`);
      
      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        
        try {
          logger.info(`📝 Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(insertData.length/batchSize)} (${batch.length} records)...`);
          
          await trx.raw(`
            INSERT INTO timeseries.token_prices (
              token_address, time, price_usd, price_sol,
              virtual_sol_reserves, virtual_token_reserves,
              real_sol_reserves, real_token_reserves,
              market_cap, liquidity_usd, slot, source
            ) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}
            ON CONFLICT (token_address, time) DO UPDATE SET
              price_usd = EXCLUDED.price_usd,
              price_sol = EXCLUDED.price_sol,
              market_cap = EXCLUDED.market_cap,
              liquidity_usd = EXCLUDED.liquidity_usd
          `, batch.flatMap(d => [
            d.token_address,
            d.time,
            d.price_usd,
            d.price_sol,
            d.virtual_sol_reserves,
            d.virtual_token_reserves,
            d.real_sol_reserves,
            d.real_token_reserves,
            d.market_cap,
            d.liquidity_usd,
            d.slot,
            d.source
          ]));
          
          logger.info(`✅ Batch ${Math.floor(i/batchSize) + 1} inserted successfully`);
          
        } catch (batchError: any) {
          logger.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, {
            message: batchError?.message,
            code: batchError?.code,
            detail: batchError?.detail,
            batchSize: batch.length,
            sampleData: batch[0]
          });
          throw batchError; // Re-throw to fail the transaction
        }
      }
      
      logger.info(`✅ All price batches inserted successfully`);
      
    } catch (error: any) {
      logger.error(`❌ PRICE FLUSH ERROR:`, {
        message: error?.message || 'No message',
        code: error?.code || 'No code',
        detail: error?.detail || 'No detail',
        priceCount: this.buffers.prices.length
      });
      throw error; // Re-throw to fail the transaction
    }
  }
  
  private async flushTransactions(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.transactions.length === 0) return;
    
    try {
      const uniqueTokens = [...new Set(this.buffers.transactions.map(tx => tx.tokenAddress))];
      logger.info(`💰 Processing ${this.buffers.transactions.length} transactions...`);
      
      // Filter out transactions with unknown token address
      const validTransactions = this.buffers.transactions.filter(tx => 
        tx.tokenAddress && tx.tokenAddress !== 'unknown'
      );
      
      if (validTransactions.length === 0) {
        logger.info(`⚠️ No valid transactions to process`);
        return;
      }
      
      logger.info(`💰 ${validTransactions.length} valid transactions after filtering`);
      
      // CRITICAL: Ensure all tokens exist in the database before inserting transactions
      const uniqueTokenAddresses = [...new Set(validTransactions.map(tx => tx.tokenAddress))];
      logger.info(`🎯 Found ${uniqueTokenAddresses.length} unique token addresses in transactions`);
      
      const existingTokens = await trx('tokens')
        .whereIn('address', uniqueTokenAddresses)
        .pluck('address');
      
      const existingTokenSet = new Set(existingTokens);
      const missingTokens = uniqueTokenAddresses.filter(addr => !existingTokenSet.has(addr));
      
      logger.info(`📊 Transaction tokens: ${existingTokens.length} existing, ${missingTokens.length} missing`);
      
      // Insert any missing tokens with minimal data BEFORE inserting transactions
      if (missingTokens.length > 0) {
        logger.info(`➕ Inserting ${missingTokens.length} missing tokens for transactions...`);
        
        const tokensToInsert = missingTokens.map(address => {
          // Find a sample transaction for this token to get some data
          const sampleTx = validTransactions.find(tx => tx.tokenAddress === address);
          
          return {
            address,
            symbol: 'LOADING...',
            name: 'Loading...',
            category: 'NEW',
            created_at: sampleTx?.timestamp || new Date(),
            current_price_usd: sampleTx?.priceUsd || 0,
            current_price_sol: sampleTx?.priceSol || 0,
            market_cap: 0,
            last_price_update: new Date()
          };
        });
        
        await trx('tokens')
          .insert(tokensToInsert)
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'last_price_update']);
        
        logger.info(`✅ Missing tokens for transactions inserted successfully`);
        
        // Queue missing tokens for metadata fetch
        for (const tokenAddress of missingTokens) {
          HELIUS_METADATA_SERVICE.queueTokenForMetadata(tokenAddress);
          logger.debug(`📝 Queued metadata fetch for transaction token: ${tokenAddress.substring(0, 8)}...`);
        }
      }
      
      // Now insert transactions (all tokens guaranteed to exist)
      logger.info(`📊 Preparing transaction data for insertion...`);
      
      const insertData = validTransactions.map(tx => ({
        signature: tx.signature,
        token_address: tx.tokenAddress,
        time: tx.timestamp,
        type: tx.type,
        user_address: tx.userAddress,
        token_amount: tx.tokenAmount?.toString() || '0',
        sol_amount: tx.solAmount?.toString() || '0',
        price_usd: tx.priceUsd,
        price_sol: tx.priceSol,
        slot: tx.slot,
        fee: tx.fee?.toString() || '0'
      }));
      
      // Insert in batches
      const batchSize = 50; // Smaller batch size to reduce conflicts
      logger.info(`📦 Inserting ${insertData.length} transactions in batches of ${batchSize}...`);
      
      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        
        try {
          logger.info(`📝 Inserting transaction batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(insertData.length/batchSize)} (${batch.length} records)...`);
          
          await trx('timeseries.token_transactions')
            .insert(batch)
            .onConflict(['signature', 'token_address', 'time'])
            .ignore();
          
          logger.info(`✅ Transaction batch ${Math.floor(i/batchSize) + 1} inserted successfully`);
          
        } catch (batchError: any) {
          logger.error(`❌ Transaction batch ${Math.floor(i/batchSize) + 1} failed:`, {
            message: batchError?.message,
            code: batchError?.code,
            detail: batchError?.detail,
            batchSize: batch.length,
            sampleData: batch[0]
          });
          throw batchError; // Re-throw to fail the transaction
        }
      }
      
      logger.info(`✅ All transaction batches inserted successfully`);
      
    } catch (error: any) {
      logger.error(`❌ TRANSACTION FLUSH ERROR:`, {
        message: error?.message || 'No message',
        code: error?.code || 'No code',
        detail: error?.detail || 'No detail',
        transactionCount: this.buffers.transactions.length
      });
      throw error; // Re-throw to fail the transaction
    }
  }
  
  private async calculatePriceChanges(): Promise<void> {
    try {
      await this.db.raw('SELECT calculate_price_changes()');
    } catch (error: any) {
      this.stats.errors++;
    }
  }
  
  // ENHANCED: Clean stats display with liquidity + volume analytics
  private displayCleanStats(): void {
    const heliusStats = HELIUS_METADATA_SERVICE.getStats();
    const liquidityGrowthStats = LIQUIDITY_GROWTH_TRACKER.getSummaryStats();
    const liquidityAlertsStats = LIQUIDITY_MILESTONE_ALERTS.getAlertStats();
    // NEW V4.27: Get volume analytics stats
    const volumeStats = VOLUME_ANALYTICS_SERVICE.getStats();
    
    console.log('\n' + '='.repeat(80));
    console.log('🚀 ENHANCED PUMP.FUN BOT STATUS v4.27');
    console.log('='.repeat(80));
    console.log(`📊 Processed: ${this.stats.pricesProcessed} prices | ${this.stats.newTokensDiscovered} new tokens`);
    console.log(`💰 Activity: ${this.stats.buysDetected} buys | ${this.stats.sellsDetected} sells`);
    console.log(`📝 Metadata Queue: ${heliusStats.processingQueue} processing | ${heliusStats.retryQueue} retrying`);
    console.log(`💎 Liquidity: ${this.stats.liquidityMilestonesTriggered} milestones | ${this.stats.highQualityLiquidityDetected} high-quality | ${this.stats.liquidityMomentumEvents} momentum`);
    console.log(`🎯 Analytics: ${liquidityGrowthStats.totalTokens} tracked | ${liquidityGrowthStats.highMomentum} high momentum | ${liquidityGrowthStats.accelerating} accelerating`);
    // NEW V4.27: Volume analytics stats
    console.log(`📈 Volume: ${volumeStats.tokensTracked} tracked | ${volumeStats.alertsTriggered} alerts | ${volumeStats.totalCalculations} calculations`);
    console.log(`🚨 Volume Alerts: ${volumeStats.alertsTriggered} triggered | ${volumeStats.tokensInCache} in cache`);
    console.log(`🚨 Alerts: ${liquidityAlertsStats.trackedTokens} tracked tokens | ${liquidityAlertsStats.totalMilestones} total milestones`);
    console.log(`❌ Errors: ${this.stats.errors} | Volume Errors: ${volumeStats.processingErrors}`);
    console.log(`🕐 Last Flush: ${this.stats.lastFlush.toLocaleTimeString()}`);
    console.log('='.repeat(80) + '\n');

    // Display top liquidity performers if available
    if (liquidityGrowthStats.topGrowers.length > 0) {
      console.log('🏆 TOP LIQUIDITY PERFORMERS:');
      liquidityGrowthStats.topGrowers.forEach((grower, index) => {
        console.log(`   ${index + 1}. ${grower.token} | +${grower.growthRate.toFixed(2)} SOL/h | ${grower.momentum}`);
      });
      console.log('');
    }
  }
  
  // ENHANCED: Get stats with liquidity + volume analytics
  getStats() {
    return {
      ...this.stats,
      bufferSizes: {
        prices: this.buffers.prices.length,
        transactions: this.buffers.transactions.length,
        newTokens: this.buffers.newTokens.size
      },
      isRunning: this.isRunning,
      grpcConnected: this.grpcClient.isActive(),
      metadata: HELIUS_METADATA_SERVICE.getStats(),
      liquidityAnalytics: {
        growth: LIQUIDITY_GROWTH_TRACKER.getSummaryStats(),
        alerts: LIQUIDITY_MILESTONE_ALERTS.getAlertStats(),
        trackedTokensCount: this.lastLiquidityValues.size,
        throttledTokensCount: this.liquidityCheckThrottles.size
      },
      // NEW V4.27: Volume analytics stats
      volumeAnalytics: VOLUME_ANALYTICS_SERVICE.getStats()
    };
  }

  /**
   * Get liquidity analytics summary
   */
  getLiquidityAnalyticsSummary() {
    return {
      trackedTokens: this.lastLiquidityValues.size,
      milestonesTriggered: this.stats.liquidityMilestonesTriggered,
      highQualityDetected: this.stats.highQualityLiquidityDetected,
      momentumEvents: this.stats.liquidityMomentumEvents,
      growthTracker: LIQUIDITY_GROWTH_TRACKER.getSummaryStats(),
      milestoneAlerts: LIQUIDITY_MILESTONE_ALERTS.getAlertStats()
    };
  }

  /**
   * Force liquidity analysis for a specific token
   */
  async forceLiquidityAnalysis(tokenAddress: string): Promise<any> {
    try {
      const tokenData = await this.db('tokens').where('address', tokenAddress).first();
      if (!tokenData) {
        throw new Error('Token not found');
      }

      // Force all liquidity analytics
      const [growthMetrics, qualityScore] = await Promise.all([
        LIQUIDITY_GROWTH_TRACKER.calculateGrowthRate(tokenAddress),
        LIQUIDITY_QUALITY_SCORER.scoreLiquidityQuality(tokenAddress)
      ]);

      // Check milestones with current data
      const milestones = await LIQUIDITY_MILESTONE_ALERTS.checkMilestones(tokenAddress, {
        liquidity_usd: tokenData.liquidity * this.solPriceUsd,
        real_sol_reserves: tokenData.liquidity * 1e9,
        timestamp: new Date()
      });

      return {
        tokenAddress,
        growthMetrics,
        qualityScore,
        milestones,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Error in force liquidity analysis for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * NEW V4.27: Get volume analytics for a specific token
   */
  async getTokenVolumeAnalytics(tokenAddress: string): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.analyzeToken(tokenAddress);
    } catch (error) {
      logger.error(`Error getting volume analytics for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * NEW V4.27: Get volume leaderboard
   */
  async getVolumeLeaderboard(timeWindow: '1h' | '4h' | '24h' = '1h'): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard(timeWindow);
    } catch (error) {
      logger.error('Error getting volume leaderboard:', error);
      return [];
    }
  }

  /**
   * NEW V4.27: Get recent volume alerts
   */
  async getRecentVolumeAlerts(limit: number = 50): Promise<any> {
    try {
      return await VOLUME_ANALYTICS_SERVICE.getRecentAlerts(limit);
    } catch (error) {
      logger.error('Error getting recent volume alerts:', error);
      return [];
    }
  }

  /**
   * NEW V4.27: Force volume analysis for a token
   */
  async forceVolumeAnalysis(tokenAddress: string): Promise<any> {
    try {
      const result = await VOLUME_ANALYTICS_SERVICE.analyzeToken(tokenAddress);
      logger.info(`💰 Force volume analysis completed for: ${tokenAddress.substring(0, 8)}...`);
      return result;
    } catch (error) {
      logger.error(`Error in force volume analysis for ${tokenAddress}:`, error);
      return null;
    }
  }
}