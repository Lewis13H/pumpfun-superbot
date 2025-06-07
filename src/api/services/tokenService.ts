import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

export class TokenService {
  async getLiveTokens(filters: any) {
    try {
      let query = db('enhanced_token_metrics')
        .select('*')
        .orderBy('market_cap', 'desc');

      // Apply filters
      if (filters.minMarketCap) {
        query = query.where('market_cap', '>=', filters.minMarketCap);
      }

      if (filters.platform && filters.platform !== 'all') {
        query = query.where('platform', filters.platform);
      }

      // Pagination
      const limit = Math.min(filters.limit || 50, 100);
      const offset = filters.offset || 0;
      
      query = query.limit(limit).offset(offset);

      const tokens = await query;
      
      // Get total count for pagination
      const countResult = await db('enhanced_token_metrics').count('* as total').first();
      const total = countResult?.total || 0;

      return {
        tokens,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      };
    } catch (error) {
      logger.error('Error getting live tokens:', error);
      throw error;
    }
  }

  async getTokenDetails(address: string) {
    try {
      const token = await db('enhanced_token_metrics')
        .where('token_address', address)
        .first();

      if (!token) {
        throw new Error('Token not found');
      }

      // Get additional details
      const [security, holders, signals] = await Promise.all([
        this.getTokenSecurity(address),
        this.getTokenHolders(address),
        this.getTokenSignals(address)
      ]);

      return {
        ...token,
        security,
        holders,
        signals
      };
    } catch (error) {
      logger.error('Error getting token details:', error);
      throw error;
    }
  }

  private async getTokenSecurity(address: string) {
    // Fetch from token_security_audits table
    return db('token_security_audits')
      .where('token_address', address)
      .first();
  }

  private async getTokenHolders(address: string) {
    // Get top holders
    return db('token_holders')
      .where('token_address', address)
      .orderBy('percentage', 'desc')
      .limit(10);
  }

  private async getTokenSignals(address: string) {
    // Get active signals
    return db('token_signals')
      .where('token_address', address)
      .where('status', 'ACTIVE')
      .orderBy('generated_at', 'desc');
  }
}
