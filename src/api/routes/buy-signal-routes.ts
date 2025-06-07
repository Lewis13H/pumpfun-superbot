import { Router } from 'express';
import { buySignalEvaluator } from '../../trading/buy-signal-evaluator';
import { buySignalService } from '../../trading/buy-signal-service';
import { positionSizer } from '../../trading/position-sizer';
import { db } from '../../database/postgres';

const router = Router();

/**
 * Get AIM tokens ready for evaluation
 */
router.get('/buy-signals/aim-tokens', async (req, res) => {
  try {
    const tokens = await buySignalEvaluator.getAimTokensForEvaluation();
    
    const enrichedTokens = await Promise.all(
      tokens.map(async (token) => {
        const timeInAim = await db('category_transitions')
          .where('token_address', token.address)
          .where('to_category', 'AIM')
          .orderBy('created_at', 'desc')
          .first();
        
        return {
          address: token.address,
          symbol: token.symbol,
          marketCap: Number(token.market_cap),
          liquidity: Number(token.liquidity),
          holders: token.holders,
          solsnifferScore: token.solsniffer_score,
          timeInAim: timeInAim 
            ? Math.round((Date.now() - new Date(timeInAim.created_at).getTime()) / 1000)
            : 0,
          buyAttempts: token.buy_attempts || 0,
        };
      })
    );
    
    res.json({
      success: true,
      data: enrichedTokens,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Evaluate specific token for buy signal
 */
router.post('/buy-signals/evaluate/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Check token exists and is in AIM
    const token = await db('tokens')
      .where('address', address)
      .first();
    
    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'Token not found',
      });
    }
    
    if (token.category !== 'AIM') {
      return res.status(400).json({
        success: false,
        error: `Token is in ${token.category} category, not AIM`,
      });
    }
    
    // Perform evaluation
    const evaluation = await buySignalEvaluator.evaluateToken(address);
    
    // Calculate position if passed
    let positionSize = null;
    if (evaluation.passed) {
      positionSize = positionSizer.calculatePosition(evaluation);
    }
    
    res.json({
      success: true,
      data: {
        evaluation,
        positionSize,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get buy signal history
 */
router.get('/buy-signals/history', async (req, res) => {
  try {
    const { status = 'all', timeframe = '7d', limit = 100 } = req.query;
    
    let query = db('buy_evaluations as be')
      .join('tokens as t', 'be.token_address', 't.address')
      .select(
        'be.*',
        't.symbol',
        't.name'
      )
      .orderBy('be.created_at', 'desc')
      .limit(Number(limit));
    
    // Filter by status
    if (status === 'passed') {
      query = query.where('be.passed', true);
    } else if (status === 'failed') {
      query = query.where('be.passed', false);
    }
    
    // Filter by timeframe
    const since = new Date();
    switch (timeframe) {
      case '24h':
        since.setHours(since.getHours() - 24);
        break;
      case '7d':
        since.setDate(since.getDate() - 7);
        break;
      case '30d':
        since.setDate(since.getDate() - 30);
        break;
    }
    query = query.where('be.created_at', '>', since);
    
    const evaluations = await query;
    
    res.json({
      success: true,
      data: evaluations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get active buy signals
 */
router.get('/buy-signals/active', async (req, res) => {
  try {
    const activeSignals = buySignalService.getActiveSignals();
    
    res.json({
      success: true,
      data: activeSignals.map(signal => ({
        tokenAddress: signal.tokenAddress,
        symbol: signal.symbol,
        marketCap: signal.evaluation.marketCap,
        confidence: signal.evaluation.confidence,
        position: signal.position.finalPosition,
        reasoning: signal.position.reasoning,
        timestamp: signal.timestamp,
      })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get buy signal statistics
 */
router.get('/buy-signals/stats', async (req, res) => {
  try {
    const stats = await buySignalService.getStats();
    
    // Add success rate by market cap range
    const successByRange = await db('buy_evaluations')
      .select(
        db.raw(`
          CASE 
            WHEN market_cap < 50000 THEN '35k-50k'
            WHEN market_cap < 70000 THEN '50k-70k'
            ELSE '70k-105k'
          END as range
        `),
        db.raw('COUNT(*) as total'),
        db.raw('SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed')
      )
      .groupBy('range');
    
    res.json({
      success: true,
      data: {
        ...stats,
        successByMarketCapRange: successByRange,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

