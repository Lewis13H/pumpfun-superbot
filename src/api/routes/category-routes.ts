import { Router } from 'express';
import { categoryManager } from '../../category/category-manager';
import { scanScheduler } from '../../category/scan-scheduler';
import { buySignalEvaluator } from '../../trading/buy-signal-evaluator';
import { db } from '../../database/postgres';
import { TokenCategory } from '../../config/category-config';

const router = Router();

/**
 * Get tokens by category
 */
router.get('/tokens/by-category/:category', async (req, res) => {
  try {
    const category = req.params.category.toUpperCase() as TokenCategory;
    const { limit = 50, offset = 0, orderBy = 'category_updated_at', order = 'desc' } = req.query;
    
    const validCategories = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
      });
    }
    
    const tokens = await db('tokens')
      .where('category', category)
      .orderBy(orderBy as string, order as string)
      .limit(Number(limit))
      .offset(Number(offset))
      .select(
        'address',
        'symbol',
        'name',
        'category',
        'category_updated_at',
        'previous_category',
        'category_scan_count',
        'market_cap',
        'liquidity',
        'volume_24h',
        'holders',
        'aim_attempts',
        'buy_attempts'
      );
    
    const count = await db('tokens')
      .where('category', category)
      .count('* as total')
      .first();
    
    res.json({
      success: true,
      data: {
        category,
        count: Number(count?.total) || 0,
        tokens,
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
 * Get token state history
 */
router.get('/tokens/:address/state-history', async (req, res) => {
  try {
    const { address } = req.params;
    
    const token = await db('tokens')
      .where('address', address)
      .first();
    
    if (!token) {
      return res.status(404).json({
        success: false,
        error: 'Token not found',
      });
    }
    
    const transitions = await db('category_transitions')
      .where('token_address', address)
      .orderBy('created_at', 'asc');
    
    res.json({
      success: true,
      data: {
        tokenAddress: address,
        currentCategory: token.category,
        transitions,
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
 * Manual category override (admin)
 */
router.post('/tokens/:address/change-category', async (req, res) => {
  try {
    const { address } = req.params;
    const { category, reason = 'manual_override' } = req.body;
    
    if (!category) {
      return res.status(400).json({
        success: false,
        error: 'Category is required',
      });
    }
    
    await categoryManager.manualCategoryOverride(address, category, reason);
    
    res.json({
      success: true,
      data: {
        message: 'Category updated successfully',
        tokenAddress: address,
        newCategory: category,
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
 * Get category flow analytics
 */
router.get('/analytics/category-flow', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    // Calculate time window
    let since = new Date();
    switch (timeframe) {
      case '1h':
        since.setHours(since.getHours() - 1);
        break;
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
    
    // Get transitions
    const transitions = await db('category_transitions')
      .where('created_at', '>', since)
      .select('from_category', 'to_category')
      .count('* as count')
      .groupBy('from_category', 'to_category');
    
    // Get current distribution
    const distribution = await categoryManager.getCategoryDistribution();
    
    // Calculate average time to AIM
    const timeToAim = await db('category_transitions')
      .where('to_category', 'AIM')
      .where('created_at', '>', since)
      .join('tokens', 'category_transitions.token_address', 'tokens.address')
      .select(db.raw('AVG(EXTRACT(EPOCH FROM (category_transitions.created_at - tokens.discovered_at))) as avg_seconds'))
      .first();
    
    res.json({
      success: true,
      data: {
        timeframe,
        flows: transitions,
        categoryDistribution: distribution,
        avgTimeToAim: timeToAim?.avg_seconds || null,
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
