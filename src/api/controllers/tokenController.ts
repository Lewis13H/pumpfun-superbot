// src/api/controllers/token.controller.ts
import { Request, Response } from 'express';
import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

export class TokenController {
  async getTokens(req: Request, res: Response) {
    try {
      const {
        limit = 50,
        offset = 0,
        orderBy = 'discovered_at',
        order = 'desc',
        classification,
        minMarketCap,
        maxMarketCap,
        minScore
      } = req.query;

      let query = db('tokens')
        .select('*')
        .limit(Number(limit))
        .offset(Number(offset))
        .orderBy(orderBy as string, order as string);

      // Apply filters
      if (classification) {
        query = query.where('investment_classification', classification);
      }
      if (minMarketCap) {
        query = query.where('market_cap', '>=', Number(minMarketCap));
      }
      if (maxMarketCap) {
        query = query.where('market_cap', '<=', Number(maxMarketCap));
      }
      if (minScore) {
        query = query.where('composite_score', '>=', Number(minScore));
      }

      const tokens = await query;

      // Transform database fields to camelCase for frontend
      const transformedTokens = tokens.map(token => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        createdAt: token.created_at,
        discoveredAt: token.discovered_at,
        marketCap: Number(token.market_cap || 0),
        current_price: Number(token.price || 0),
        priceChange24h: Number(token.price_change_24h || 0),
        volume24h: Number(token.volume_24h || 0),
        liquidity: Number(token.liquidity || 0),
        holders: token.holders || 0,
        safetyScore: Number(token.safety_score || 0),
        potentialScore: Number(token.potential_score || 0),
        compositeScore: Number(token.composite_score || 0),
        investmentClassification: token.investment_classification || 'STANDARD',
        analysisStatus: token.analysis_status
      }));

      res.json(transformedTokens);
    } catch (error) {
      logger.error('Error fetching tokens:', error);
      res.status(500).json({ error: 'Failed to fetch tokens' });
    }
  }

  async getTokenDetail(req: Request, res: Response) {
    try {
      const { address } = req.params;

      // Get basic token info
      const token = await db('tokens')
        .where('address', address)
        .first();

      if (!token) {
        return res.status(404).json({ error: 'Token not found' });
      }

      // Get security analysis
      const security = await db('token_security_audits')
        .where('token_address', address)
        .first();

      // Get recent signals
      const signals = await db('token_signals')
        .where('token_address', address)
        .orderBy('generated_at', 'desc')
        .limit(10);

      // Get price history (last 24h, hourly)
      const priceHistory = await db('metric_snapshots')
        .select('snapshot_timestamp as time', 'price')
        .where('token_address', address)
        .where('snapshot_timestamp', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .orderBy('snapshot_timestamp', 'asc');

      // Get holder distribution
      const holderDistribution = await this.getHolderDistribution(address);

      // Get smart money activity
      const smartMoneyActivity = await this.getSmartMoneyActivity(address);

      // Transform and combine all data
      const tokenDetail = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        marketCap: Number(token.market_cap || 0),
        current_price: Number(token.price || 0),
        priceChange24h: Number(token.price_change_24h || 0),
        volume24h: Number(token.volume_24h || 0),
        liquidity: Number(token.liquidity || 0),
        holders: token.holders || 0,
        security: security ? {
          rugPullRisk: Number(security.rug_pull_risk || 0),
          honeypot: security.is_honeypot || false,
          liquidityLocked: security.liquidity_locked || false,
          mintDisabled: security.mint_authority_revoked || false,
          topHolderPercent: Number(security.top_holder_percent || 0),
          contractVerified: security.contract_verified || false
        } : this.getDefaultSecurity(),
        signals: signals.map(signal => ({
          type: signal.signal_type,
          confidence: Number(signal.confidence),
          reason: signal.reasons?.[0] || 'Analysis-based signal',
          timestamp: signal.generated_at
        })),
        priceHistory: priceHistory.map(point => ({
          time: new Date(point.time).toLocaleTimeString(),
          current_price: Number(point.price)
        })),
        holderDistribution,
        smartMoneyActivity
      };

      res.json(tokenDetail);
    } catch (error) {
      logger.error('Error fetching token detail:', error);
      res.status(500).json({ error: 'Failed to fetch token details' });
    }
  }

  private async getHolderDistribution(tokenAddress: string) {
    // Simulate holder distribution if not in database
    // In production, this would come from actual holder analysis
    return [
      { range: '0-100', count: 450, percentage: 45 },
      { range: '100-1K', count: 300, percentage: 30 },
      { range: '1K-10K', count: 200, percentage: 20 },
      { range: '10K+', count: 50, percentage: 5 }
    ];
  }

  private async getSmartMoneyActivity(tokenAddress: string) {
    // Get recent smart money transactions
    // This would integrate with your alpha wallet tracking
    try {
      const activities = await db('smart_money_signals')
        .where('token_address', tokenAddress)
        .orderBy('detected_at', 'desc')
        .limit(10);

      return activities.map(activity => ({
        wallet: activity.wallet_address,
        action: activity.signal_type,
        amount: Number(activity.amount),
        timestamp: activity.detected_at,
        profit: activity.profit_percentage
      }));
    } catch (error) {
      // Return mock data if table doesn't exist yet
      return [
        {
          wallet: 'DV2e...MKtq',
          action: 'BUY' as const,
          amount: 5000,
          timestamp: new Date().toISOString(),
          profit: undefined
        }
      ];
    }
  }

  private getDefaultSecurity() {
    return {
      rugPullRisk: 0.5,
      honeypot: false,
      liquidityLocked: false,
      mintDisabled: false,
      topHolderPercent: 20,
      contractVerified: false
    };
  }
}

