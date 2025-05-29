// src/api/controllers/market.controller.ts
import { Request, Response } from 'express';
import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

export class MarketController {
  async getMarketMetrics(req: Request, res: Response) {
    try {
      // Get overall market metrics
      const totalTokens = await db('tokens').count('* as count').first();
      
      const marketStats = await db('tokens')
        .select(
          db.raw('SUM(market_cap) as total_market_cap'),
          db.raw('SUM(volume_24h) as total_volume'),
          db.raw('AVG(price_change_24h) as avg_price_change'),
          db.raw('COUNT(CASE WHEN price_change_24h > 0 THEN 1 END) as gainers'),
          db.raw('COUNT(CASE WHEN price_change_24h < 0 THEN 1 END) as losers')
        )
        .first();

      // Get top gainers and losers
      const topGainers = await db('tokens')
        .select('symbol', 'name', 'price_change_24h', 'market_cap')
        .where('price_change_24h', '>', 0)
        .orderBy('price_change_24h', 'desc')
        .limit(5);

      const topLosers = await db('tokens')
        .select('symbol', 'name', 'price_change_24h', 'market_cap')
        .where('price_change_24h', '<', 0)
        .orderBy('price_change_24h', 'asc')
        .limit(5);

      res.json({
        overview: {
          totalTokens: totalTokens?.count || 0,
          totalMarketCap: Number(marketStats.total_market_cap || 0),
          totalVolume24h: Number(marketStats.total_volume || 0),
          avgPriceChange24h: Number(marketStats.avg_price_change || 0),
          gainers: marketStats.gainers || 0,
          losers: marketStats.losers || 0
        },
        topGainers: topGainers.map(token => ({
          symbol: token.symbol,
          name: token.name,
          priceChange24h: Number(token.price_change_24h),
          marketCap: Number(token.market_cap)
        })),
        topLosers: topLosers.map(token => ({
          symbol: token.symbol,
          name: token.name,
          priceChange24h: Number(token.price_change_24h),
          marketCap: Number(token.market_cap)
        }))
      });
    } catch (error) {
      logger.error('Error fetching market metrics:', error);
      res.status(500).json({ error: 'Failed to fetch market metrics' });
    }
  }

  async getMarketTrends(req: Request, res: Response) {
    try {
      const { timeframe = '24h' } = req.query;
      
      let hoursBack = 24;
      if (timeframe === '7d') hoursBack = 168;
      if (timeframe === '30d') hoursBack = 720;

      const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Get hourly market trends
      const trends = await db('metric_snapshots')
        .select(
          db.raw('DATE_TRUNC(\'hour\', snapshot_timestamp) as hour'),
          db.raw('COUNT(DISTINCT token_address) as active_tokens'),
          db.raw('AVG(price) as avg_price'),
          db.raw('SUM(volume_1h) as total_volume')
        )
        .where('snapshot_timestamp', '>', startTime)
        .groupBy(db.raw('DATE_TRUNC(\'hour\', snapshot_timestamp)'))
        .orderBy('hour', 'asc');

      res.json({
        timeframe,
        trends: trends.map(trend => ({
          time: trend.hour,
          activeTokens: Number(trend.active_tokens),
          avgPrice: Number(trend.avg_price),
          totalVolume: Number(trend.total_volume)
        }))
      });
    } catch (error) {
      logger.error('Error fetching market trends:', error);
      res.status(500).json({ error: 'Failed to fetch market trends' });
    }
  }
}