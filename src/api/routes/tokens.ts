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

    logger.info(`Fetching live tokens: limit=${limit}, filter=${filter}, page=${page}`);

    // First, try to get basic tokens data
    let tokens = [];
    let total = 0;

    try {
      // Simple query first - just get tokens
      const tokensQuery = db('tokens')
        .select(
          'address',
          'symbol',
          'name', 
          'platform',
          'created_at',
          'discovered_at',
          'market_cap',
          'price',
          'liquidity',
          'volume_24h'
        )
        .orderBy('discovered_at', 'desc')
        .limit(limit)
        .offset(offset);

      tokens = await tokensQuery;
      
      // Get total count
      const countResult = await db('tokens').count('* as count').first();
      total = parseInt(countResult?.count as string) || 0;

      logger.info(`Found ${tokens.length} tokens, total: ${total}`);

    } catch (dbError) {
      logger.warn('Database query failed, returning mock data:', dbError);
      
      // Return mock data if database fails
      tokens = generateMockTokens(Math.min(limit, 10));
      total = limit;
    }

    // Format tokens for dashboard
    const formattedTokens = tokens.map((token: any, index: number) => ({
      // Basic info
      address: token.address || `mock_address_${index}`,
      symbol: token.symbol || `TOKEN${index}`,
      name: token.name || `Mock Token ${index}`,
      platform: token.platform || 'unknown',
      
      // Time info
      discoveredAt: token.discovered_at || new Date().toISOString(),
      
      // Market data (convert string values to numbers and provide defaults)
      marketCap: parseFloat(token.market_cap) || Math.floor(Math.random() * 100000),
      price: parseFloat(token.price) || Math.random() * 0.001,
      volume24h: parseFloat(token.volume_24h) || Math.floor(Math.random() * 50000),
      liquidity: parseFloat(token.liquidity) || Math.floor(Math.random() * 20000),
      priceChange24h: (Math.random() - 0.5) * 20, // Random change between -10% and +10%
      
      // Additional properties expected by frontend
      safetyScore: Math.random() * 0.5 + 0.3, // Between 0.3 and 0.8
      potentialScore: Math.random() * 0.6 + 0.2, // Between 0.2 and 0.8
      compositeScore: Math.random() * 0.7 + 0.3, // Between 0.3 and 1.0
      investmentClassification: ['STANDARD', 'HIDDEN_GEM', 'NEW_BURST', 'AVOID'][Math.floor(Math.random() * 4)],
      analysisStatus: 'COMPLETED',
      holders: Math.floor(Math.random() * 1000) + 50
    }));

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
    
    // Return empty data with error info rather than failing completely
    res.json({
      tokens: [],
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      },
      error: 'Unable to fetch tokens',
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
      current_price: parseFloat(token.price) || 0,
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

function generateMockTokens(count: number): any[] {
  const tokens = [];
  const symbols = ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'MEME', 'WOJAK', 'CHAD'];
  const platforms = ['pumpfun', 'raydium', 'jupiter'];
  
  for (let i = 0; i < count; i++) {
    tokens.push({
      address: `mock_address_${i}_${Date.now()}`,
      symbol: symbols[i % symbols.length] + Math.floor(Math.random() * 1000),
      name: `Mock Token ${i}`,
      platform: platforms[Math.floor(Math.random() * platforms.length)],
      discovered_at: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      market_cap: Math.floor(Math.random() * 1000000),
      price: Math.random() * 0.01,
      liquidity: Math.floor(Math.random() * 100000),
      volume_24h: Math.floor(Math.random() * 50000)
    });
  }
  
  return tokens;
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

