// src/api/routes/db-stats.ts
import { Router } from 'express';
import { db } from '../../database/postgres';

const router = Router();

router.get('/db-stats', async (req, res) => {
  try {
    const stats = {
      tokens: {
        total: (await db('tokens').count('* as count').first())?.count || 0,
        pumpFun: (await db('tokens').where('is_pump_fun', true).count('* as count').first())?.count || 0,
        last24h: (await db('tokens').where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'")).count('* as count').first())?.count || 0,
        lastHour: (await db('tokens').where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'")).count('* as count').first())?.count || 0,
      },
      apiCosts: {
        today: (await db('api_call_logs').whereRaw('DATE(timestamp) = CURRENT_DATE').sum('cost as total').first())?.total || 0,
        calls: (await db('api_call_logs').whereRaw('DATE(timestamp) = CURRENT_DATE').count('* as count').first())?.count || 0,
      },
      recentTokens: await db('tokens')
        .select('symbol', 'name', 'is_pump_fun', 'market_cap', 'created_at')
        .orderBy('created_at', 'desc')
        .limit(10)
    };
    
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;