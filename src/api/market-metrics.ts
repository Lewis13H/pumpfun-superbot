// src/api/market-metrics.ts
import { Router } from 'express';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { EnhancedTokenAnalyzer } from '../analysis/enhanced-token-analyzer';
import { MarketMetricsAnalyzer } from '../analysis/market-metrics-analyzer';

export const marketMetricsRouter = Router();

// Initialize analyzers (these should be shared singletons in a real app)
let enhancedAnalyzer: EnhancedTokenAnalyzer | null = null;
let marketAnalyzer: MarketMetricsAnalyzer | null = null;

// Initialize analyzers
export function initializeAnalyzers(enhanced: EnhancedTokenAnalyzer, market: MarketMetricsAnalyzer) {
  enhancedAnalyzer = enhanced;
  marketAnalyzer = market;
}

// Get current market overview
marketMetricsRouter.get('/overview', async (req, res) => {
  try {
    const overview = await db.raw(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN composite_score > 0.7 THEN 1 END) as high_score_tokens,
        COUNT(CASE WHEN investment_classification = 'HIDDEN_GEM' THEN 1 END) as hidden_gems,
        COUNT(CASE WHEN investment_classification = 'NEW_BURST' THEN 1 END) as new_bursts,
        COUNT(CASE WHEN investment_classification = 'HIGH_RISK' THEN 1 END) as high_risk_tokens,
        AVG(composite_score) as avg_composite_score,
        AVG(safety_score) as avg_safety_score,
        AVG(potential_score) as avg_potential_score
      FROM tokens 
      WHERE analysis_status = 'COMPLETED' 
      AND discovered_at > NOW() - INTERVAL '24 HOURS'
    `);

    const marketActivity = await db.raw(`
      SELECT 
        COUNT(*) as active_tokens,
        AVG(volume_24h) as avg_volume_24h,
        SUM(volume_24h) as total_volume_24h,
        AVG(market_cap) as avg_market_cap,
        COUNT(CASE WHEN volume_24h > 50000 THEN 1 END) as high_volume_tokens
      FROM market_analysis_current
      WHERE last_updated > NOW() - INTERVAL '1 HOUR'
    `);

    const recentAlerts = await db('price_alerts')
      .select('alert_type', 'severity', 'COUNT(*) as count')
      .where('triggered_at', '>', db.raw("NOW() - INTERVAL '1 HOUR'"))
      .groupBy('alert_type', 'severity')
      .orderBy('count', 'desc');

    res.json({
      timestamp: new Date().toISOString(),
      token_overview: overview.rows[0],
      market_activity: marketActivity.rows[0],
      recent_alerts: recentAlerts,
      analyzer_status: {
        enhanced_analyzer_running: enhancedAnalyzer?.getStats().isRunning || false,
        market_analyzer_running: marketAnalyzer?.getStats().isRunning || false,
        tokens_monitored: marketAnalyzer?.getStats().tokensMonitored || 0,
      },
    });
  } catch (error) {
    logger.error('Failed to get market overview:', error);
    res.status(500).json({ error: 'Failed to get market overview' });
  }
});

// Get top performing tokens
marketMetricsRouter.get('/top-tokens', async (req, res) => {
  try {
    const { 
      limit = 20, 
      tier = 'all', 
      sort = 'composite_score',
      timeframe = '24h' 
    } = req.query;

    let query = db('market_analysis_current')
      .select(
        'address',
        'symbol',
        'name',
        'platform',
        'composite_score',
        'market_health_score',
        'risk_level',
        'price',
        'price_change_24h',
        'volume_24h',
        'liquidity_usd',
        'market_cap',
        'trend_direction',
        'trend_strength',
        'manipulation_score',
        'last_updated'
      )
      .where('last_updated', '>', db.raw(`NOW() - INTERVAL '${timeframe === '1h' ? '1 HOUR' : '24 HOURS'}'`))
      .limit(Number(limit));

    // Filter by tier if specified
    if (tier !== 'all') {
      const tierMap: Record<string, string> = {
        'gems': 'HIDDEN_GEM',
        'burst': 'NEW_BURST',
        'standard': 'STANDARD',
        'risk': 'HIGH_RISK',
        'avoid': 'AVOID',
      };
      
      if (tierMap[tier as string]) {
        query = query.join('tokens', 'market_analysis_current.address', 'tokens.address')
          .where('tokens.investment_classification', tierMap[tier as string]);
      }
    }

    // Sort by specified field
    const validSortFields = ['composite_score', 'market_health_score', 'volume_24h', 'price_change_24h', 'market_cap'];
    if (validSortFields.includes(sort as string)) {
      query = query.orderBy(sort as string, 'desc');
    } else {
      query = query.orderBy('composite_score', 'desc');
    }

    const tokens = await query;

    res.json({
      total: tokens.length,
      filters: { tier, sort, timeframe, limit },
      tokens: tokens.map(token => ({
        ...token,
        current_price: parseFloat(token.price || '0'),
        price_change_24h: parseFloat(token.price_change_24h || '0'),
        volume_24h: parseFloat(token.volume_24h || '0'),
        liquidity_usd: parseFloat(token.liquidity_usd || '0'),
        market_cap: parseFloat(token.market_cap || '0'),
        composite_score: parseFloat(token.composite_score || '0'),
        market_health_score: parseFloat(token.market_health_score || '0'),
        trend_strength: parseFloat(token.trend_strength || '0'),
        manipulation_score: parseFloat(token.manipulation_score || '0'),
      })),
    });
  } catch (error) {
    logger.error('Failed to get top tokens:', error);
    res.status(500).json({ error: 'Failed to get top tokens' });
  }
});

// Get detailed token analysis
marketMetricsRouter.get('/token/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { include_history = 'false' } = req.query;

    if (!enhancedAnalyzer) {
      return res.status(500).json({ error: 'Enhanced analyzer not initialized' });
    }

    // Get enhanced analysis
    const analysis = await enhancedAnalyzer.getEnhancedAnalysis(address);
    
    if (!analysis) {
      return res.status(404).json({ error: 'Token not found or not analyzed' });
    }

    let response: any = {
      analysis,
      current_metrics: analysis.marketMetrics,
    };

    // Include historical data if requested
    if (include_history === 'true') {
      const historicalMetrics = await db('market_metrics_history')
        .select('*')
        .where('token_address', address)
        .where('timestamp', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
        .orderBy('timestamp', 'desc')
        .limit(288); // 24 hours of 5-minute intervals

      const tradingPatterns = await db('trading_patterns')
        .select('*')
        .where('token_address', address)
        .where('detected_at', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
        .orderBy('detected_at', 'desc');

      const alerts = await db('price_alerts')
        .select('*')
        .where('token_address', address)
        .where('triggered_at', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
        .orderBy('triggered_at', 'desc');

      response.historical_data = {
        metrics: historicalMetrics,
        patterns: tradingPatterns,
        alerts: alerts,
      };
    }

    res.json(response);
  } catch (error) {
    logger.error(`Failed to get token analysis for ${req.params.address}:`, error);
    res.status(500).json({ error: 'Failed to get token analysis' });
  }
});

// Get recent alerts
marketMetricsRouter.get('/alerts', async (req, res) => {
  try {
    const { 
      limit = 50, 
      severity = 'all',
      type = 'all',
      processed = 'false' 
    } = req.query;

    let query = db('price_alerts')
      .join('tokens', 'price_alerts.token_address', 'tokens.address')
      .select(
        'price_alerts.*',
        'tokens.symbol',
        'tokens.name',
        'tokens.platform'
      )
      .orderBy('price_alerts.triggered_at', 'desc')
      .limit(Number(limit));

    // Filter by severity
    if (severity !== 'all') {
      query = query.where('price_alerts.severity', severity.toString().toUpperCase());
    }

    // Filter by type
    if (type !== 'all') {
      query = query.where('price_alerts.alert_type', type.toString().toUpperCase());
    }

    // Filter by processed status
    query = query.where('price_alerts.is_processed', processed === 'true');

    const alerts = await query;

    res.json({
      total: alerts.length,
      filters: { severity, type, processed, limit },
      alerts: alerts.map(alert => ({
        id: alert.id,
        token: {
          address: alert.token_address,
          symbol: alert.symbol,
          name: alert.name,
          platform: alert.platform,
        },
        alert_type: alert.alert_type,
        severity: alert.severity,
        message: alert.message,
        threshold_value: parseFloat(alert.threshold_value),
        current_value: parseFloat(alert.current_value),
        percentage_change: parseFloat(alert.percentage_change),
        triggered_at: alert.triggered_at,
        is_processed: alert.is_processed,
      })),
    });
  } catch (error) {
    logger.error('Failed to get alerts:', error);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// Mark alert as processed
marketMetricsRouter.post('/alerts/:id/process', async (req, res) => {
  try {
    const { id } = req.params;
    
    const updated = await db('price_alerts')
      .where('id', id)
      .update({ is_processed: true })
      .returning('*');

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ message: 'Alert marked as processed', alert: updated[0] });
  } catch (error) {
    logger.error('Failed to process alert:', error);
    res.status(500).json({ error: 'Failed to process alert' });
  }
});

// Get market metrics for a specific token (real-time)
marketMetricsRouter.get('/token/:address/metrics', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!marketAnalyzer) {
      return res.status(500).json({ error: 'Market analyzer not initialized' });
    }

    const metrics = await marketAnalyzer.getTokenMetrics(address);
    
    if (!metrics) {
      return res.status(404).json({ error: 'No metrics available for this token' });
    }

    res.json({
      token_address: address,
      metrics: {
        ...metrics,
        current_price: parseFloat(metrics.current_price?.toString() || '0'),
        volume_24h: parseFloat(metrics.volume24h?.toString() || '0'),
        liquidity_usd: parseFloat(metrics.liquidityUsd?.toString() || '0'),
        market_cap: parseFloat(metrics.marketCap?.toString() || '0'),
      },
      last_updated: metrics.timestamp,
    });
  } catch (error) {
    logger.error(`Failed to get metrics for ${req.params.address}:`, error);
    res.status(500).json({ error: 'Failed to get token metrics' });
  }
});

// Force analysis of a specific token
marketMetricsRouter.post('/token/:address/analyze', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!enhancedAnalyzer || !marketAnalyzer) {
      return res.status(500).json({ error: 'Analyzers not initialized' });
    }

    // Check if token exists
    const token = await db('tokens')
      .select('*')
      .where('address', address)
      .first();

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    // Trigger analysis
    const tokenDiscovery = {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: token.platform,
      createdAt: token.created_at || new Date(),
      metadata: token.raw_data || {},
    };

    const analysis = await enhancedAnalyzer.analyzeToken(tokenDiscovery);

    res.json({
      message: 'Analysis completed',
      analysis: {
        token_address: analysis.tokenAddress,
        investment_tier: analysis.investmentTier,
        composite_score: analysis.compositeScore,
        market_health_score: analysis.marketHealthScore,
        risk_score: analysis.overallRiskScore,
        confidence_score: analysis.confidenceScore,
        processing_time_ms: analysis.processingTimeMs,
        alert_flags: analysis.alertFlags,
        reasoning_points: analysis.reasoningPoints,
      },
    });
  } catch (error) {
    logger.error(`Failed to analyze token ${req.params.address}:`, error);
    res.status(500).json({ error: 'Failed to analyze token' });
  }
});

// Get historical price data
marketMetricsRouter.get('/token/:address/history', async (req, res) => {
  try {
    const { address } = req.params;
    const { 
      timeframe = '24h',
      interval = '5m' 
    } = req.query;

    // Map timeframe to SQL interval
    const timeframeMap: Record<string, string> = {
      '1h': '1 HOUR',
      '6h': '6 HOURS',
      '24h': '24 HOURS',
      '7d': '7 DAYS',
      '30d': '30 DAYS',
    };

    const sqlInterval = timeframeMap[timeframe as string] || '24 HOURS';

    const history = await db('market_metrics_history')
      .select(
        'timestamp',
        'price',
        'volume_1h',
        'volume_24h',
        'liquidity_usd',
        'market_cap',
        'price_change_1h',
        'volatility_1h',
        'trend_direction',
        'manipulation_score'
      )
      .where('token_address', address)
      .where('timestamp', '>', db.raw(`NOW() - INTERVAL '${sqlInterval}'`))
      .orderBy('timestamp', 'asc');

    // Group by interval if needed (for now, return all data)
    res.json({
      token_address: address,
      timeframe,
      interval,
      data_points: history.length,
      history: history.map(point => ({
        timestamp: point.timestamp,
        current_price: parseFloat(point.price || '0'),
        volume_1h: parseFloat(point.volume_1h || '0'),
        volume_24h: parseFloat(point.volume_24h || '0'),
        liquidity_usd: parseFloat(point.liquidity_usd || '0'),
        market_cap: parseFloat(point.market_cap || '0'),
        price_change_1h: parseFloat(point.price_change_1h || '0'),
        volatility_1h: parseFloat(point.volatility_1h || '0'),
        trend_direction: point.trend_direction,
        manipulation_score: parseFloat(point.manipulation_score || '0'),
      })),
    });
  } catch (error) {
    logger.error(`Failed to get history for ${req.params.address}:`, error);
    res.status(500).json({ error: 'Failed to get token history' });
  }
});

// Get trading patterns
marketMetricsRouter.get('/patterns', async (req, res) => {
  try {
    const { 
      limit = 20,
      pattern_type = 'all',
      confidence_min = 0.5 
    } = req.query;

    let query = db('trading_patterns')
      .join('tokens', 'trading_patterns.token_address', 'tokens.address')
      .select(
        'trading_patterns.*',
        'tokens.symbol',
        'tokens.name'
      )
      .where('trading_patterns.confidence_score', '>=', Number(confidence_min))
      .where('trading_patterns.detected_at', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
      .orderBy('trading_patterns.confidence_score', 'desc')
      .limit(Number(limit));

    if (pattern_type !== 'all') {
      query = query.where('trading_patterns.pattern_type', pattern_type.toString().toUpperCase());
    }

    const patterns = await query;

    res.json({
      total: patterns.length,
      filters: { pattern_type, confidence_min, limit },
      patterns: patterns.map(pattern => ({
        id: pattern.id,
        token: {
          address: pattern.token_address,
          symbol: pattern.symbol,
          name: pattern.name,
        },
        pattern_type: pattern.pattern_type,
        confidence_score: parseFloat(pattern.confidence_score),
        detected_at: pattern.detected_at,
        predicted_direction: pattern.predicted_direction,
        predicted_timeframe: pattern.predicted_timeframe,
        pattern_data: pattern.pattern_data,
        validation: {
          actual_outcome: pattern.actual_outcome,
          validation_timestamp: pattern.validation_timestamp,
          pattern_success: pattern.pattern_success,
        },
      })),
    });
  } catch (error) {
    logger.error('Failed to get trading patterns:', error);
    res.status(500).json({ error: 'Failed to get trading patterns' });
  }
});

// Get analyzer statistics
marketMetricsRouter.get('/stats', async (req, res) => {
  try {
    const enhancedStats = enhancedAnalyzer?.getStats() || {};
    const marketStats = marketAnalyzer?.getStats() || {};

    // Get database statistics
    const dbStats = await db.raw(`
      SELECT 
        (SELECT COUNT(*) FROM tokens WHERE analysis_status = 'COMPLETED') as completed_tokens,
        (SELECT COUNT(*) FROM market_metrics_history WHERE timestamp > NOW() - INTERVAL '1 HOUR') as recent_metrics,
        (SELECT COUNT(*) FROM price_alerts WHERE triggered_at > NOW() - INTERVAL '1 HOUR') as recent_alerts,
        (SELECT COUNT(*) FROM trading_patterns WHERE detected_at > NOW() - INTERVAL '24 HOURS') as recent_patterns,
        (SELECT AVG(composite_score) FROM tokens WHERE composite_score > 0) as avg_composite_score
    `);

    const performanceStats = await db('analysis_performance')
      .select('*')
      .where('timestamp', '>', db.raw("NOW() - INTERVAL '24 HOURS'"))
      .orderBy('timestamp', 'desc')
      .limit(1);

    res.json({
      timestamp: new Date().toISOString(),
      analyzers: {
        enhanced_analyzer: enhancedStats,
        market_analyzer: marketStats,
      },
      database: dbStats.rows[0],
      performance: performanceStats[0] || null,
      system: {
        uptime_seconds: process.uptime(),
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        node_version: process.version,
      },
    });
  } catch (error) {
    logger.error('Failed to get analyzer stats:', error);
    res.status(500).json({ error: 'Failed to get analyzer statistics' });
  }
});

export default marketMetricsRouter;

