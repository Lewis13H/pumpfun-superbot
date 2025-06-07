// src/api/controllers/signal.controller.ts
import { Request, Response } from 'express';
import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

export class SignalController {
  async getSignalHistory(req: Request, res: Response) {
    try {
      const { timeframe = '7d', strategy = 'all' } = req.query;
      
      let hoursBack = 168; // 7 days default
      if (timeframe === '24h') hoursBack = 24;
      if (timeframe === '30d') hoursBack = 720;

      const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      let query = db('token_signals')
        .select(
          'token_signals.*',
          'tokens.symbol as token_symbol',
          'tokens.name as token_name'
        )
        .leftJoin('tokens', 'token_signals.token_address', 'tokens.address')
        .where('generated_at', '>', startTime)
        .orderBy('generated_at', 'desc')
        .limit(100);

      if (strategy !== 'all') {
        query = query.where('strategy', strategy);
      }

      const signals = await query;

      // Transform signals and add mock outcome data
      const transformedSignals = signals.map(signal => {
        const hoursSince = (Date.now() - new Date(signal.generated_at).getTime()) / (1000 * 60 * 60);
        const hasOutcome = hoursSince > 24; // Signals older than 24h have outcomes

        return {
          id: signal.id,
          tokenAddress: signal.token_address,
          tokenSymbol: signal.token_symbol || signal.symbol,
          signalType: signal.signal_type,
          strategy: signal.strategy,
          confidence: Number(signal.confidence),
          targetPrice: Number(signal.target_price),
          stopLoss: Number(signal.stop_loss),
          generatedAt: signal.generated_at,
          outcome: hasOutcome ? this.generateMockOutcome(signal) : undefined
        };
      });

      res.json(transformedSignals);
    } catch (error) {
      logger.error('Error fetching signal history:', error);
      res.status(500).json({ error: 'Failed to fetch signal history' });
    }
  }

  async getSignalStats(req: Request, res: Response) {
    try {
      const { timeframe = '7d' } = req.query;
      
      let hoursBack = 168;
      if (timeframe === '24h') hoursBack = 24;
      if (timeframe === '30d') hoursBack = 720;

      const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Get signal statistics
      const stats = await db('token_signals')
        .select(
          db.raw('COUNT(*) as total_signals'),
          db.raw('COUNT(CASE WHEN signal_type = \'BUY\' THEN 1 END) as buy_signals'),
          db.raw('COUNT(CASE WHEN signal_type = \'SELL\' THEN 1 END) as sell_signals'),
          db.raw('AVG(confidence) as avg_confidence')
        )
        .where('generated_at', '>', startTime)
        .first();

      // Get strategy breakdown
      const strategyBreakdown = await db('token_signals')
        .select('strategy')
        .count('* as signals')
        .where('generated_at', '>', startTime)
        .groupBy('strategy');

      // Generate mock performance data
      const mockStats = {
        totalSignals: Number(stats.total_signals) || 0,
        winRate: 72.5,
        totalProfit: 156.8,
        averageProfit: 3.2,
        bestTrade: 45.2,
        worstTrade: -12.5,
        averageHoldTime: 18,
        strategyBreakdown: strategyBreakdown.map(item => ({
          strategy: item.strategy,
          winRate: 65 + Math.random() * 20,
          signals: Number(item.signals)
        }))
      };

      res.json(mockStats);
    } catch (error) {
      logger.error('Error fetching signal stats:', error);
      res.status(500).json({ error: 'Failed to fetch signal statistics' });
    }
  }

  async getProfitHistory(req: Request, res: Response) {
    try {
      const { timeframe = '7d' } = req.query;
      
      // Generate mock profit history
      const days = timeframe === '24h' ? 1 : timeframe === '7d' ? 7 : 30;
      const profitHistory = [];
      let cumulative = 0;

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        
        const dailyProfit = -5 + Math.random() * 15;
        cumulative += dailyProfit;

        profitHistory.push({
          date: date.toLocaleDateString(),
          profit: Number(dailyProfit.toFixed(2)),
          cumulative: Number(cumulative.toFixed(2))
        });
      }

      res.json(profitHistory);
    } catch (error) {
      logger.error('Error fetching profit history:', error);
      res.status(500).json({ error: 'Failed to fetch profit history' });
    }
  }

  private generateMockOutcome(signal: any) {
    const isWin = Math.random() > 0.3; // 70% win rate
    const profit = isWin ? 
      5 + Math.random() * 40 : 
      -5 - Math.random() * 20;

    return {
      status: isWin ? 'WIN' : 'LOSS',
      profit: Number(profit.toFixed(2)),
      duration: Math.floor(12 + Math.random() * 36),
      exitPrice: Number(signal.target_price) * (1 + profit / 100)
    };
  }
}
