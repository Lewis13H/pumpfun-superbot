// src/api/signals.ts - Signal history endpoints
import { Router } from 'express';
import { db } from '../database/postgres';
import { logger } from '../utils/logger';

const router = Router();

router.get('/history', async (req, res) => {
  try {
    const { timeframe = '7d', strategy = 'all' } = req.query;
    
    // For now, return mock data - replace with actual signal data when implemented
    const signals = [
      {
        id: '1',
        tokenAddress: 'DV2eQq...MKtq',
        tokenSymbol: 'BONK',
        signalType: 'BUY',
        strategy: 'graduation',
        confidence: 0.85,
        targetPrice: 0.00002,
        stopLoss: 0.000015,
        generatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        outcome: {
          status: 'WIN',
          profit: 23.5,
          duration: 18,
          exitPrice: 0.000025
        }
      },
      {
        id: '2',
        tokenAddress: 'So11111...1112',
        tokenSymbol: 'MYRO',
        signalType: 'BUY',
        strategy: 'smartMoney',
        confidence: 0.72,
        targetPrice: 0.15,
        stopLoss: 0.12,
        generatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        outcome: {
          status: 'LOSS',
          profit: -8.2,
          duration: 6,
          exitPrice: 0.11
        }
      }
    ];

    res.json(signals);
  } catch (error) {
    logger.error('Error fetching signal history:', error);
    res.status(500).json({ error: 'Failed to fetch signal history' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { timeframe = '7d' } = req.query;
    
    // Mock performance stats - replace with actual data
    const stats = {
      totalSignals: 156,
      winRate: 72.5,
      totalProfit: 156.8,
      averageProfit: 3.2,
      bestTrade: 45.2,
      worstTrade: -12.5,
      averageHoldTime: 18,
      strategyBreakdown: [
        { strategy: 'graduation', winRate: 78.5, signals: 45 },
        { strategy: 'smartMoney', winRate: 71.2, signals: 38 },
        { strategy: 'technical', winRate: 68.9, signals: 42 },
        { strategy: 'momentum', winRate: 65.3, signals: 31 }
      ]
    };

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching signal stats:', error);
    res.status(500).json({ error: 'Failed to fetch signal statistics' });
  }
});

router.get('/profit-history', async (req, res) => {
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
});

export default router;
