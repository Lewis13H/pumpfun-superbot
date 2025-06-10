// src/services/volume-analytics-service.ts
// V4.27: Comprehensive Volume Tracking and Alerting for MEDIUM, HIGH, AIM tokens

import { EventEmitter } from 'events';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';

export interface VolumeMetrics {
  tokenAddress: string;
  timeWindow: '1h' | '4h' | '24h';
  
  // Volume data
  totalVolumeSol: number;
  totalVolumeUsd: number;
  buyVolumeSol: number;
  buyVolumeUsd: number;
  sellVolumeSol: number;
  sellVolumeUsd: number;
  netVolumeSol: number; // buys - sells
  netVolumeUsd: number;
  
  // Transaction counts
  totalTransactions: number;
  buyTransactions: number;
  sellTransactions: number;
  
  // Ratios and analytics
  buyVolumeRatio: number; // % of volume that is buys
  sellVolumeRatio: number;
  averageTransactionSizeUsd: number;
  volumeVelocity: number; // transactions per hour
  
  // Compared to historical averages
  volumeGrowthFromAverage: number; // % change from 7-day average
  transactionGrowthFromAverage: number;
  
  // Metadata
  calculatedAt: Date;
  category: string;
  currentMarketCap: number;
}

export interface VolumeAlert {
  tokenAddress: string;
  symbol: string;
  alertType: 'VOLUME_SPIKE' | 'VOLUME_THRESHOLD' | 'BUY_SELL_IMBALANCE' | 'UNUSUAL_PATTERN';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  
  message: string;
  details: {
    currentValue: number;
    thresholdValue: number;
    percentageChange: number;
    timeWindow: string;
    comparison: string;
  };
  
  metrics: VolumeMetrics;
  triggeredAt: Date;
  category: string;
  marketCap: number;
}

export interface VolumeAlertConfig {
  // Volume spike thresholds (% above average)
  volumeSpikeThresholds: {
    low: number;    // 200% above average
    medium: number; // 300% above average  
    high: number;   // 500% above average
    critical: number; // 1000% above average
  };
  
  // Absolute volume thresholds (USD)
  absoluteVolumeThresholds: {
    medium: { '1h': number; '4h': number; '24h': number };
    high: { '1h': number; '4h': number; '24h': number };
    aim: { '1h': number; '4h': number; '24h': number };
  };
  
  // Buy/sell ratio imbalance thresholds
  imbalanceThresholds: {
    moderate: number; // 70% buys or sells
    severe: number;   // 85% buys or sells
    extreme: number;  // 95% buys or sells
  };
  
  // Minimum volume to trigger alerts (avoid noise)
  minimumVolumeUsd: number;
}

export class VolumeAnalyticsService extends EventEmitter {
  private volumeCache = new Map<string, Map<string, VolumeMetrics>>(); // token -> timeWindow -> metrics
  private lastCalculation = new Map<string, Date>();
  private alertHistory = new Map<string, VolumeAlert[]>();
  private isRunning = false;
  
  private readonly config: VolumeAlertConfig = {
    volumeSpikeThresholds: {
      low: 200,
      medium: 300,
      high: 500,
      critical: 1000
    },
    absoluteVolumeThresholds: {
      medium: { '1h': 5000, '4h': 15000, '24h': 50000 },
      high: { '1h': 10000, '4h': 30000, '24h': 100000 },
      aim: { '1h': 25000, '4h': 75000, '24h': 250000 }
    },
    imbalanceThresholds: {
      moderate: 70,
      severe: 85,
      extreme: 95
    },
    minimumVolumeUsd: 1000
  };
  
  private stats = {
    totalCalculations: 0,
    alertsTriggered: 0,
    tokensTracked: 0,
    lastUpdateTime: new Date(),
    processingErrors: 0
  };

  constructor() {
    super();
    this.setupPeriodicCalculation();
  }

  /**
   * Start the volume analytics service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Volume analytics service already running');
      return;
    }

    logger.info('🚀 Starting Volume Analytics Service V4.27...');
    
    try {
      // Verify database tables exist
      await this.verifyDatabaseSchema();
      
      // Initialize with existing data
      await this.initializeVolumeTracking();
      
      this.isRunning = true;
      logger.info('✅ Volume Analytics Service started successfully');
      
    } catch (error) {
      logger.error('Failed to start Volume Analytics Service:', error);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('🛑 Volume Analytics Service stopped');
  }

  /**
   * Process a new transaction for volume tracking
   */
  async processTransaction(transaction: {
    tokenAddress: string;
    type: 'buy' | 'sell';
    solAmount: number;
    usdValue: number;
    timestamp: Date;
    category: string;
  }): Promise<void> {
    try {
      // Only track MEDIUM, HIGH, AIM tokens
      if (!['MEDIUM', 'HIGH', 'AIM'].includes(transaction.category)) {
        return;
      }

      // Queue for volume recalculation (debounced)
      this.queueVolumeRecalculation(transaction.tokenAddress, transaction.category);
      
    } catch (error) {
      this.stats.processingErrors++;
      logger.error('Error processing transaction for volume analytics:', error);
    }
  }

  /**
   * Calculate comprehensive volume metrics for a token
   */
  async calculateVolumeMetrics(tokenAddress: string, timeWindow: '1h' | '4h' | '24h' = '1h'): Promise<VolumeMetrics | null> {
    try {
      const timeWindowHours = this.parseTimeWindow(timeWindow);
      const startTime = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

      // Get transaction data from TimescaleDB
      const transactions = await db.raw(`
        SELECT 
          type,
          sol_amount::numeric as sol_amount,
          price_usd,
          token_amount::numeric as token_amount,
          time
        FROM timeseries.token_transactions 
        WHERE token_address = ? 
          AND time > ? 
          AND type IN ('buy', 'sell')
        ORDER BY time DESC
      `, [tokenAddress, startTime]);

      if (transactions.rows.length === 0) {
        return null;
      }

      // Get current token data
      const tokenData = await db('tokens')
        .where('address', tokenAddress)
        .first();

      if (!tokenData) {
        return null;
      }

      // Calculate metrics
      const metrics = this.calculateMetricsFromTransactions(
        transactions.rows, 
        tokenAddress, 
        timeWindow,
        tokenData
      );

      // Compare to historical averages
      await this.addHistoricalComparison(metrics, tokenAddress, timeWindow);

      // Cache the metrics
      if (!this.volumeCache.has(tokenAddress)) {
        this.volumeCache.set(tokenAddress, new Map());
      }
      this.volumeCache.get(tokenAddress)!.set(timeWindow, metrics);

      this.stats.totalCalculations++;
      this.stats.lastUpdateTime = new Date();

      return metrics;

    } catch (error) {
      this.stats.processingErrors++;
      logger.error(`Error calculating volume metrics for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Check for volume alerts based on current metrics
   */
  async checkVolumeAlerts(tokenAddress: string, metrics: VolumeMetrics): Promise<VolumeAlert[]> {
    const alerts: VolumeAlert[] = [];
    
    try {
      const tokenData = await db('tokens').where('address', tokenAddress).first();
      if (!tokenData) return alerts;

      const symbol = tokenData.symbol || tokenAddress.substring(0, 8) + '...';

      // 1. Volume Spike Alerts
      if (metrics.volumeGrowthFromAverage > 0) {
        const spikeAlert = this.checkVolumeSpikeAlert(metrics, symbol);
        if (spikeAlert) alerts.push(spikeAlert);
      }

      // 2. Absolute Volume Threshold Alerts
      const thresholdAlert = this.checkAbsoluteVolumeAlert(metrics, symbol);
      if (thresholdAlert) alerts.push(thresholdAlert);

      // 3. Buy/Sell Imbalance Alerts
      const imbalanceAlert = this.checkImbalanceAlert(metrics, symbol);
      if (imbalanceAlert) alerts.push(imbalanceAlert);

      // 4. Unusual Pattern Alerts
      const patternAlert = await this.checkUnusualPatternAlert(metrics, symbol);
      if (patternAlert) alerts.push(patternAlert);

      // Store alerts and emit events
      for (const alert of alerts) {
        await this.storeAlert(alert);
        this.emitAlert(alert);
      }

      this.stats.alertsTriggered += alerts.length;

    } catch (error) {
      logger.error('Error checking volume alerts:', error);
    }

    return alerts;
  }

  /**
   * Get volume summary for multiple tokens
   */
  async getVolumeSummary(category?: 'MEDIUM' | 'HIGH' | 'AIM', limit: number = 20): Promise<VolumeMetrics[]> {
    try {
      let query = db('tokens')
        .whereIn('category', category ? [category] : ['MEDIUM', 'HIGH', 'AIM'])
        .where('last_price_update', '>', new Date(Date.now() - 10 * 60 * 1000)) // Active in last 10 minutes
        .orderBy('market_cap', 'desc')
        .limit(limit);

      const tokens = await query;
      const summaries: VolumeMetrics[] = [];

      for (const token of tokens) {
        const metrics = await this.calculateVolumeMetrics(token.address, '1h');
        if (metrics && metrics.totalVolumeUsd > this.config.minimumVolumeUsd) {
          summaries.push(metrics);
        }
      }

      return summaries.sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd);

    } catch (error) {
      logger.error('Error getting volume summary:', error);
      return [];
    }
  }

  /**
   * Get top volume performers
   */
  async getTopVolumePerformers(timeWindow: '1h' | '4h' | '24h' = '1h', limit: number = 10): Promise<VolumeMetrics[]> {
    try {
      const allMetrics: VolumeMetrics[] = [];
      
      // Get active tokens in target categories
      const tokens = await db('tokens')
        .whereIn('category', ['MEDIUM', 'HIGH', 'AIM'])
        .where('last_price_update', '>', new Date(Date.now() - 30 * 60 * 1000))
        .pluck('address');

      // Calculate metrics for each token
      const calculations = tokens.map(async (tokenAddress) => {
        const metrics = await this.calculateVolumeMetrics(tokenAddress, timeWindow);
        if (metrics && metrics.totalVolumeUsd > this.config.minimumVolumeUsd) {
          return metrics;
        }
        return null;
      });

      const results = await Promise.all(calculations);
      const validMetrics = results.filter(m => m !== null) as VolumeMetrics[];

      return validMetrics
        .sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd)
        .slice(0, limit);

    } catch (error) {
      logger.error('Error getting top volume performers:', error);
      return [];
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(limit: number = 50, severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): Promise<VolumeAlert[]> {
    try {
      let query = db('volume_alerts')
        .orderBy('triggered_at', 'desc')
        .limit(limit);

      if (severity) {
        query = query.where('severity', severity);
      }

      const alertData = await query;
      return alertData.map(row => ({
        ...row,
        details: JSON.parse(row.details),
        metrics: JSON.parse(row.metrics)
      }));

    } catch (error) {
      logger.error('Error getting recent alerts:', error);
      return [];
    }
  }

  // Helper methods...

  private calculateMetricsFromTransactions(
    transactions: any[], 
    tokenAddress: string, 
    timeWindow: string,
    tokenData: any
  ): VolumeMetrics {
    const buys = transactions.filter(tx => tx.type === 'buy');
    const sells = transactions.filter(tx => tx.type === 'sell');

    const buyVolumeSol = buys.reduce((sum, tx) => sum + parseFloat(tx.sol_amount || '0'), 0);
    const sellVolumeSol = sells.reduce((sum, tx) => sum + parseFloat(tx.sol_amount || '0'), 0);
    const buyVolumeUsd = buys.reduce((sum, tx) => sum + (parseFloat(tx.sol_amount || '0') * parseFloat(tx.price_usd || '0')), 0);
    const sellVolumeUsd = sells.reduce((sum, tx) => sum + (parseFloat(tx.sol_amount || '0') * parseFloat(tx.price_usd || '0')), 0);

    const totalVolumeSol = buyVolumeSol + sellVolumeSol;
    const totalVolumeUsd = buyVolumeUsd + sellVolumeUsd;
    const netVolumeSol = buyVolumeSol - sellVolumeSol;
    const netVolumeUsd = buyVolumeUsd - sellVolumeUsd;

    const totalTransactions = transactions.length;
    const buyTransactions = buys.length;
    const sellTransactions = sells.length;

    const buyVolumeRatio = totalVolumeUsd > 0 ? (buyVolumeUsd / totalVolumeUsd) * 100 : 0;
    const sellVolumeRatio = 100 - buyVolumeRatio;
    const averageTransactionSizeUsd = totalTransactions > 0 ? totalVolumeUsd / totalTransactions : 0;
    
    const timeWindowHours = this.parseTimeWindow(timeWindow as any);
    const volumeVelocity = totalTransactions / timeWindowHours;

    return {
      tokenAddress,
      timeWindow: timeWindow as any,
      totalVolumeSol,
      totalVolumeUsd,
      buyVolumeSol,
      buyVolumeUsd,
      sellVolumeSol,
      sellVolumeUsd,
      netVolumeSol,
      netVolumeUsd,
      totalTransactions,
      buyTransactions,
      sellTransactions,
      buyVolumeRatio,
      sellVolumeRatio,
      averageTransactionSizeUsd,
      volumeVelocity,
      volumeGrowthFromAverage: 0, // Will be set by addHistoricalComparison
      transactionGrowthFromAverage: 0,
      calculatedAt: new Date(),
      category: tokenData.category,
      currentMarketCap: tokenData.market_cap
    };
  }

  private parseTimeWindow(timeWindow: '1h' | '4h' | '24h'): number {
    switch (timeWindow) {
      case '1h': return 1;
      case '4h': return 4;
      case '24h': return 24;
      default: return 1;
    }
  }

  private async addHistoricalComparison(metrics: VolumeMetrics, tokenAddress: string, timeWindow: string): Promise<void> {
    try {
      // Get 7-day average for comparison
      const timeWindowHours = this.parseTimeWindow(timeWindow as any);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const windowStart = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

      const historicalAverage = await db.raw(`
        SELECT 
          AVG(total_volume_usd) as avg_volume,
          AVG(total_transactions) as avg_transactions
        FROM (
          SELECT 
            date_trunc('hour', time) as hour,
            COUNT(*) as total_transactions,
            SUM(sol_amount::numeric * price_usd) as total_volume_usd
          FROM timeseries.token_transactions 
          WHERE token_address = ? 
            AND time BETWEEN ? AND ?
            AND type IN ('buy', 'sell')
          GROUP BY date_trunc('hour', time)
        ) hourly_data
      `, [tokenAddress, sevenDaysAgo, windowStart]);

      if (historicalAverage.rows.length > 0 && historicalAverage.rows[0].avg_volume) {
        const avgVolume = parseFloat(historicalAverage.rows[0].avg_volume);
        const avgTransactions = parseFloat(historicalAverage.rows[0].avg_transactions);

        metrics.volumeGrowthFromAverage = avgVolume > 0 
          ? ((metrics.totalVolumeUsd - avgVolume) / avgVolume) * 100 
          : 0;
        
        metrics.transactionGrowthFromAverage = avgTransactions > 0 
          ? ((metrics.totalTransactions - avgTransactions) / avgTransactions) * 100 
          : 0;
      }
    } catch (error) {
      logger.debug('Error adding historical comparison:', error);
    }
  }

  private checkVolumeSpikeAlert(metrics: VolumeMetrics, symbol: string): VolumeAlert | null {
    const growth = metrics.volumeGrowthFromAverage;
    
    if (growth < this.config.volumeSpikeThresholds.low) {
      return null;
    }

    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (growth >= this.config.volumeSpikeThresholds.critical) {
      severity = 'CRITICAL';
    } else if (growth >= this.config.volumeSpikeThresholds.high) {
      severity = 'HIGH';
    } else if (growth >= this.config.volumeSpikeThresholds.medium) {
      severity = 'MEDIUM';
    } else {
      severity = 'LOW';
    }

    return {
      tokenAddress: metrics.tokenAddress,
      symbol,
      alertType: 'VOLUME_SPIKE',
      severity,
      message: `${symbol} volume spike: +${growth.toFixed(1)}% above 7-day average`,
      details: {
        currentValue: metrics.totalVolumeUsd,
        thresholdValue: this.config.volumeSpikeThresholds[severity.toLowerCase() as keyof typeof this.config.volumeSpikeThresholds],
        percentageChange: growth,
        timeWindow: metrics.timeWindow,
        comparison: '7-day average'
      },
      metrics,
      triggeredAt: new Date(),
      category: metrics.category,
      marketCap: metrics.currentMarketCap
    };
  }

  private checkAbsoluteVolumeAlert(metrics: VolumeMetrics, symbol: string): VolumeAlert | null {
    const category = metrics.category.toLowerCase() as 'medium' | 'high' | 'aim';
    const threshold = this.config.absoluteVolumeThresholds[category]?.[metrics.timeWindow];
    
    if (!threshold || metrics.totalVolumeUsd < threshold) {
      return null;
    }

    return {
      tokenAddress: metrics.tokenAddress,
      symbol,
      alertType: 'VOLUME_THRESHOLD',
      severity: 'MEDIUM',
      message: `${symbol} crossed ${metrics.timeWindow} volume threshold: $${metrics.totalVolumeUsd.toFixed(0)}`,
      details: {
        currentValue: metrics.totalVolumeUsd,
        thresholdValue: threshold,
        percentageChange: ((metrics.totalVolumeUsd - threshold) / threshold) * 100,
        timeWindow: metrics.timeWindow,
        comparison: `${category.toUpperCase()} category threshold`
      },
      metrics,
      triggeredAt: new Date(),
      category: metrics.category,
      marketCap: metrics.currentMarketCap
    };
  }

  private checkImbalanceAlert(metrics: VolumeMetrics, symbol: string): VolumeAlert | null {
    const buyRatio = metrics.buyVolumeRatio;
    const sellRatio = metrics.sellVolumeRatio;
    
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | null = null;
    let type: string = '';
    
    if (buyRatio >= this.config.imbalanceThresholds.extreme) {
      severity = 'HIGH';
      type = 'extreme buy pressure';
    } else if (sellRatio >= this.config.imbalanceThresholds.extreme) {
      severity = 'HIGH';
      type = 'extreme sell pressure';
    } else if (buyRatio >= this.config.imbalanceThresholds.severe) {
      severity = 'MEDIUM';
      type = 'severe buy pressure';
    } else if (sellRatio >= this.config.imbalanceThresholds.severe) {
      severity = 'MEDIUM';
      type = 'severe sell pressure';
    } else if (buyRatio >= this.config.imbalanceThresholds.moderate || 
               sellRatio >= this.config.imbalanceThresholds.moderate) {
      severity = 'LOW';
      type = buyRatio > sellRatio ? 'moderate buy pressure' : 'moderate sell pressure';
    }

    if (!severity) return null;

    const dominantRatio = Math.max(buyRatio, sellRatio);
    
    return {
      tokenAddress: metrics.tokenAddress,
      symbol,
      alertType: 'BUY_SELL_IMBALANCE',
      severity,
      message: `${symbol} ${type}: ${dominantRatio.toFixed(1)}% ${buyRatio > sellRatio ? 'buys' : 'sells'}`,
      details: {
        currentValue: dominantRatio,
        thresholdValue: this.config.imbalanceThresholds.moderate,
        percentageChange: 0,
        timeWindow: metrics.timeWindow,
        comparison: `Buy: ${buyRatio.toFixed(1)}% | Sell: ${sellRatio.toFixed(1)}%`
      },
      metrics,
      triggeredAt: new Date(),
      category: metrics.category,
      marketCap: metrics.currentMarketCap
    };
  }

  private async checkUnusualPatternAlert(metrics: VolumeMetrics, symbol: string): Promise<VolumeAlert | null> {
    // Check for unusual patterns like sudden transaction velocity changes
    if (metrics.volumeVelocity > 100 && metrics.averageTransactionSizeUsd < 50) {
      return {
        tokenAddress: metrics.tokenAddress,
        symbol,
        alertType: 'UNUSUAL_PATTERN',
        severity: 'MEDIUM',
        message: `${symbol} unusual pattern: High frequency, small transactions (${metrics.volumeVelocity.toFixed(1)} tx/hr)`,
        details: {
          currentValue: metrics.volumeVelocity,
          thresholdValue: 100,
          percentageChange: 0,
          timeWindow: metrics.timeWindow,
          comparison: `Avg tx size: $${metrics.averageTransactionSizeUsd.toFixed(2)}`
        },
        metrics,
        triggeredAt: new Date(),
        category: metrics.category,
        marketCap: metrics.currentMarketCap
      };
    }

    return null;
  }

  private async storeAlert(alert: VolumeAlert): Promise<void> {
    try {
      await db('volume_alerts').insert({
        token_address: alert.tokenAddress,
        symbol: alert.symbol,
        alert_type: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        details: JSON.stringify(alert.details),
        metrics: JSON.stringify(alert.metrics),
        triggered_at: alert.triggeredAt,
        category: alert.category,
        market_cap: alert.marketCap
      });
    } catch (error) {
      logger.error('Error storing volume alert:', error);
    }
  }

  private emitAlert(alert: VolumeAlert): void {
    // Terminal output
    logger.info(`🚨 VOLUME ALERT [${alert.severity}]: ${alert.message}`);
    
    // Emit for WebSocket broadcasting
    this.emit('volumeAlert', alert);
    
    // Emit specific event types for targeted handling
    this.emit(alert.alertType.toLowerCase(), alert);
    
    // Emit by severity for priority handling
    if (alert.severity === 'CRITICAL' || alert.severity === 'HIGH') {
      this.emit('criticalVolumeAlert', alert);
    }
  }

  private queueVolumeRecalculation(tokenAddress: string, category: string): void {
    // Debounced recalculation to avoid excessive computation
    const lastCalc = this.lastCalculation.get(tokenAddress);
    const now = new Date();
    
    if (lastCalc && (now.getTime() - lastCalc.getTime()) < 60000) {
      return; // Don't recalculate more than once per minute
    }
    
    this.lastCalculation.set(tokenAddress, now);
    
    // Queue async calculation
    setTimeout(async () => {
      try {
        const metrics = await this.calculateVolumeMetrics(tokenAddress, '1h');
        if (metrics) {
          await this.checkVolumeAlerts(tokenAddress, metrics);
        }
      } catch (error) {
        logger.error(`Error in queued volume calculation for ${tokenAddress}:`, error);
      }
    }, 5000); // 5 second delay to batch multiple transactions
  }

  private async setupPeriodicCalculation(): Promise<void> {
    // Calculate volume metrics for all tracked tokens every 5 minutes
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const tokens = await db('tokens')
          .whereIn('category', ['MEDIUM', 'HIGH', 'AIM'])
          .where('last_price_update', '>', new Date(Date.now() - 30 * 60 * 1000))
          .pluck('address');
        
        this.stats.tokensTracked = tokens.length;
        
        // Process in batches to avoid overwhelming the system
        const batchSize = 5;
        for (let i = 0; i < tokens.length; i += batchSize) {
          const batch = tokens.slice(i, i + batchSize);
          
          await Promise.all(batch.map(async (tokenAddress) => {
            try {
              const metrics = await this.calculateVolumeMetrics(tokenAddress, '1h');
              if (metrics && metrics.totalVolumeUsd > this.config.minimumVolumeUsd) {
                await this.checkVolumeAlerts(tokenAddress, metrics);
              }
            } catch (error) {
              logger.debug(`Error in periodic calculation for ${tokenAddress}:`, error);
            }
          }));
          
          // Small delay between batches
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        logger.error('Error in periodic volume calculation:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private async verifyDatabaseSchema(): Promise<void> {
    // Check if volume_alerts table exists, create if not
    const tableExists = await db.schema.hasTable('volume_alerts');
    
    if (!tableExists) {
      logger.info('Creating volume_alerts table...');
      await db.schema.createTable('volume_alerts', (table) => {
        table.increments('id').primary();
        table.string('token_address', 44).notNullable();
        table.string('symbol', 20);
        table.string('alert_type', 50).notNullable();
        table.string('severity', 20).notNullable();
        table.text('message').notNullable();
        table.jsonb('details');
        table.jsonb('metrics');
        table.timestamp('triggered_at').defaultTo(db.fn.now());
        table.string('category', 20);
        table.decimal('market_cap', 30, 2);
        
        table.index(['token_address', 'triggered_at']);
        table.index(['severity', 'triggered_at']);
        table.index(['alert_type', 'triggered_at']);
      });
      logger.info('✅ volume_alerts table created');
    }
  }

  private async initializeVolumeTracking(): Promise<void> {
    // Calculate initial metrics for active tokens
    const activeTokens = await db('tokens')
      .whereIn('category', ['MEDIUM', 'HIGH', 'AIM'])
      .where('last_price_update', '>', new Date(Date.now() - 60 * 60 * 1000))
      .limit(20)
      .pluck('address');
    
    logger.info(`Initializing volume tracking for ${activeTokens.length} tokens...`);
    
    for (const tokenAddress of activeTokens) {
      try {
        await this.calculateVolumeMetrics(tokenAddress, '1h');
      } catch (error) {
        logger.debug(`Error initializing volume tracking for ${tokenAddress}:`, error);
      }
    }
    
    logger.info('✅ Volume tracking initialized');
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      ...this.stats,
      tokensInCache: this.volumeCache.size,
      alertHistorySize: Array.from(this.alertHistory.values()).reduce((sum, alerts) => sum + alerts.length, 0),
      isRunning: this.isRunning,
      config: this.config
    };
  }

  /**
   * Manual trigger for specific token analysis
   */
  async analyzeToken(tokenAddress: string): Promise<{
    metrics: VolumeMetrics[];
    alerts: VolumeAlert[];
  }> {
    const timeWindows: ('1h' | '4h' | '24h')[] = ['1h', '4h', '24h'];
    const metrics: VolumeMetrics[] = [];
    const alerts: VolumeAlert[] = [];
    
    for (const timeWindow of timeWindows) {
      const metric = await this.calculateVolumeMetrics(tokenAddress, timeWindow);
      if (metric) {
        metrics.push(metric);
        const tokenAlerts = await this.checkVolumeAlerts(tokenAddress, metric);
        alerts.push(...tokenAlerts);
      }
    }
    
    return { metrics, alerts };
  }

  /**
   * Get volume leaderboard
   */
  async getVolumeLeaderboard(timeWindow: '1h' | '4h' | '24h' = '1h'): Promise<VolumeMetrics[]> {
    return this.getTopVolumePerformers(timeWindow, 25);
  }
}

// Export singleton instance
export const VOLUME_ANALYTICS_SERVICE = new VolumeAnalyticsService();