// src/api/routes/tokens.ts
import { Router } from 'express';
import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

const router = Router();

// Get live tokens for dashboard display
router.get('/live', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const filter = req.query.filter as string || 'all';
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;

    // Build query with proper joins
    let query = db('tokens')
      .leftJoin('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
      .select(
        'tokens.address',
        'tokens.symbol',
        'tokens.name',
        'tokens.platform',
        'tokens.created_at',
        'tokens.discovered_at',
        // Use COALESCE to handle null values from left join
        db.raw('COALESCE(enhanced_token_metrics.market_cap, tokens.market_cap, 0) as market_cap'),
        db.raw('COALESCE(enhanced_token_metrics.total_liquidity, tokens.liquidity, 0) as liquidity'),
        db.raw('COALESCE(enhanced_token_metrics.volume_24h, tokens.volume_24h, 0) as volume_24h'),
        db.raw('COALESCE(enhanced_token_metrics.price_change_24h, 0) as price_change_24h'),
        db.raw('COALESCE(enhanced_token_metrics.graduation_distance, 0) as graduation_distance'),
        db.raw('COALESCE(enhanced_token_metrics.buy_pressure, 0.5) as buy_pressure'),
        db.raw('COALESCE(tokens.current_price, 0) as price'),
        // Parse metadata for additional info
        db.raw(`
          CASE 
            WHEN tokens.raw_data IS NOT NULL AND tokens.raw_data::text != '' 
            THEN tokens.raw_data::jsonb->>'marketCap'
            ELSE '0'
          END as metadata_market_cap
        `)
      )
      .orderBy('tokens.discovered_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Apply filters
    if (filter === 'trending') {
      query = query.where('enhanced_token_metrics.market_cap_trend', 'INCREASING')
        .orWhere('enhanced_token_metrics.volume_24h', '>', 10000);
    } else if (filter === 'new_pairs') {
      query = query.where('tokens.created_at', '>', db.raw("NOW() - INTERVAL '1 HOUR'"));
    } else if (filter === 'graduation_ready') {
      query = query
        .where('enhanced_token_metrics.graduation_distance', '>', 0.65)
        .where('enhanced_token_metrics.graduation_distance', '<', 1.0);
    }

    const tokens = await query;

    // Format tokens for dashboard
    const formattedTokens = tokens.map(token => {
      // Use metadata market cap if database market cap is 0
      const marketCap = parseFloat(token.market_cap) || parseFloat(token.metadata_market_cap) || 0;
      
      return {
        // Basic info
        address: token.address,
        symbol: token.symbol || 'UNKNOWN',
        name: token.name || 'Unknown Token',
        platform: token.platform || 'unknown',
        
        // Time info
        age: formatAge(token.created_at || token.discovered_at),
        discoveredAt: token.discovered_at,
        
        // Market data
        liquidity: formatCurrency(parseFloat(token.liquidity) || 0),
        marketCap: formatCurrency(marketCap),
        graduation: `${Math.round((parseFloat(token.graduation_distance) || 0) * 100)}%`,
        price: formatPrice(parseFloat(token.price) || 0),
        volume24h: formatCurrency(parseFloat(token.volume_24h) || 0),
        priceChange24h: parseFloat(token.price_change_24h) || 0,
        
        // Trading info
        trend: marketCap > 0 ? 'ACTIVE' : 'NEW',
        buyPressure: parseFloat(token.buy_pressure) || 0.5,
        
        // Status
        hasData: marketCap > 0 || parseFloat(token.liquidity) > 0
      };
    });

    // Get total count
    const countResult = await db('tokens').count('* as count').first();
    const total = parseInt(countResult?.count as string) || 0;

    res.json({
      tokens: formattedTokens,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching live tokens:', error);
    res.status(500).json({ 
      error: 'Failed to fetch tokens',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get single token details
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    logger.info(`Fetching token details for: ${address}`);
    
    // Get token from database with joins
    const token = await db('tokens')
      .leftJoin('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
      .leftJoin('token_security_audits', 'tokens.address', 'token_security_audits.token_address')
      .where('tokens.address', address)
      .select(
        'tokens.*',
        db.raw('COALESCE(enhanced_token_metrics.market_cap, tokens.market_cap, 0) as market_cap'),
        db.raw('COALESCE(enhanced_token_metrics.volume_24h, tokens.volume_24h, 0) as volume_24h'),
        db.raw('COALESCE(enhanced_token_metrics.total_liquidity, tokens.liquidity, 0) as liquidity'),
        db.raw('COALESCE(enhanced_token_metrics.holder_count, 0) as holder_count'),
        db.raw('COALESCE(enhanced_token_metrics.buy_pressure, 0.5) as buy_pressure'),
        db.raw('COALESCE(enhanced_token_metrics.price_change_24h, 0) as price_change_24h'),
        db.raw('COALESCE(token_security_audits.overall_risk_score, 0.5) as overall_risk_score'),
        db.raw('COALESCE(token_security_audits.rug_pull_risk, 0.5) as rug_pull_risk')
      )
      .first();
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    // Get recent signals if any
    const signals = await db('token_signals')
      .where('token_address', address)
      .orderBy('generated_at', 'desc')
      .limit(10);

    // Transform to match frontend expectations
    const response = {
      // Basic info
      address: token.address,
      symbol: token.symbol || 'UNKNOWN',
      name: token.name || 'Unknown Token',
      marketCap: parseFloat(token.market_cap) || 0,
      price: parseFloat(token.current_price) || 0,
      priceChange24h: parseFloat(token.price_change_24h) || 0,
      volume24h: parseFloat(token.volume_24h) || 0,
      liquidity: parseFloat(token.liquidity) || 0,
      holders: parseInt(token.holder_count) || 0,
      
      // Security info
      security: {
        rugPullRisk: parseFloat(token.rug_pull_risk) || 0.5,
        honeypot: token.is_honeypot || false,
        liquidityLocked: token.liquidity_locked || false,
        mintDisabled: token.mint_authority_revoked || false,
        topHolderPercent: parseFloat(token.top_10_percentage) || 20,
        contractVerified: token.verified || false
      },
      
      // Signals
      signals: signals.map((signal: any) => ({
        type: signal.signal_type || 'HOLD',
        confidence: parseFloat(signal.confidence) || 0,
        reason: signal.reasons ? (typeof signal.reasons === 'string' ? signal.reasons : signal.reasons[0]) : 'Analysis-based signal',
        timestamp: signal.generated_at || new Date().toISOString()
      })),
      
      // Mock data for now - replace with real data when available
      priceHistory: generateMockPriceHistory(24),
      holderDistribution: generateMockHolderDistribution(),
      smartMoneyActivity: generateMockSmartMoneyActivity()
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching token details:', error);
    res.status(500).json({ 
      error: 'Failed to fetch token details',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Helper functions
function formatAge(timestamp: Date | string | null): string {
  if (!timestamp) return '0m';
  
  const now = Date.now();
  const created = new Date(timestamp).getTime();
  const diff = now - created;
  
  if (diff < 60000) return '0m';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function formatCurrency(value: number): string {
  if (!value || value === 0) return '$0';
  if (value < 1000) return `$${value.toFixed(0)}`;
  if (value < 1000000) return `$${(value / 1000).toFixed(1)}K`;
  if (value < 1000000000) return `$${(value / 1000000).toFixed(2)}M`;
  return `$${(value / 1000000000).toFixed(2)}B`;
}

function formatPrice(price: number): string {
  if (!price || price === 0) return '$0.00e+0';
  
  if (price < 0.000001) {
    return `$${price.toExponential(2)}`;
  }
  if (price < 0.01) {
    return `$${price.toFixed(6)}`;
  }
  if (price < 1) {
    return `$${price.toFixed(4)}`;
  }
  return `$${price.toFixed(2)}`;
}

function generateMockPriceHistory(hours: number) {
  const history = [];
  const basePrice = 0.0001;
  
  for (let i = hours - 1; i >= 0; i--) {
    const time = new Date(Date.now() - i * 60 * 60 * 1000);
    const variance = (Math.random() - 0.5) * 0.2;
    history.push({
      time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      price: basePrice * (1 + variance)
    });
  }
  
  return history;
}

function generateMockHolderDistribution() {
  return [
    { range: '0-100', count: 450, percentage: 45 },
    { range: '100-1K', count: 300, percentage: 30 },
    { range: '1K-10K', count: 200, percentage: 20 },
    { range: '10K+', count: 50, percentage: 5 }
  ];
}

function generateMockSmartMoneyActivity() {
  const activities = [];
  const wallets = ['DV2e...MKtq', 'So11...1112', 'EPjF...AUWE', 'Gq3H...DmPK'];
  const actions = ['BUY', 'SELL'];
  
  for (let i = 0; i < 5; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    activities.push({
      wallet: wallets[Math.floor(Math.random() * wallets.length)],
      action: action as 'BUY' | 'SELL',
      amount: Math.floor(1000 + Math.random() * 10000),
      timestamp: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      profit: action === 'SELL' ? (Math.random() * 100 - 20) : undefined
    });
  }
  
  return activities;
}

export default router;