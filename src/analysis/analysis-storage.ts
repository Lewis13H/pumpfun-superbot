import { db } from '../database/postgres';
import { logger } from '../utils/logger';

interface TokenAnalysis {
  tokenAddress: string;
  timestamp: Date;
  analyzedAt: Date;
  metrics: any;
  score: number;
  scores: {
    overallScore: number;
    [key: string]: number;
  };
  signals: any[];
  status: 'success' | 'partial' | 'failed';
}

export class TokenAnalysisStorage {
  async storeAnalysis(analysis: TokenAnalysis): Promise<void> {
    const trx = await db.transaction();
    
    try {
      // Store in token_analysis_history
      await trx('token_analysis_history').insert({
        token_address: analysis.tokenAddress,
        analyzed_at: analysis.analyzedAt,
        holders_data: JSON.stringify({ count: analysis.metrics.holders }),
        security_data: JSON.stringify({}), // Placeholder for Module 2
        liquidity_data: JSON.stringify({ 
          liquidity: analysis.metrics.liquidity,
          volume24h: analysis.metrics.volume24h,
        }),
        trading_data: JSON.stringify({
          current_price: analysis.metrics.price,
          priceChange24h: analysis.metrics.priceChange24h,
          marketCap: analysis.metrics.marketCap,
        }),
        social_data: JSON.stringify({}), // Placeholder for Module 2
        safety_score: 0, // Placeholder for Module 2
        potential_score: analysis.scores.overallScore,
        composite_score: analysis.scores.overallScore,
        ml_classification: null, // Placeholder for Module 2
        ml_confidence: null, // Placeholder for Module 2
      });

      await trx.commit();
      logger.debug(`Stored analysis for ${analysis.tokenAddress}`);
    } catch (error) {
      await trx.rollback();
      logger.error('Failed to store analysis:', error);
      throw error;
    }
  }

  async updateTokenScores(analysis: TokenAnalysis): Promise<void> {
    try {
      await db('tokens')
        .where('address', analysis.tokenAddress)
        .update({
          current_price: analysis.metrics.price,
          market_cap: analysis.metrics.marketCap,
          volume_24h: analysis.metrics.volume24h,
          liquidity: analysis.metrics.liquidity,
          safety_score: 0, // Placeholder for Module 2
          potential_score: analysis.scores.overallScore,
          composite_score: analysis.scores.overallScore,
          analysis_status: analysis.status === 'success' ? 'ANALYZED' : 
                          analysis.status === 'partial' ? 'PARTIAL' : 'FAILED',
          investment_classification: this.classifyInvestment(analysis.scores.overallScore),
          updated_at: new Date(),
        });

      logger.debug(`Updated token scores for ${analysis.tokenAddress}`);
    } catch (error) {
      logger.error('Failed to update token scores:', error);
      // Don't throw - this is not critical
    }
  }

  async getRecentAnalysis(tokenAddress: string, maxAgeMs: number): Promise<any> {
    try {
      const cutoffTime = new Date(Date.now() - maxAgeMs);
      
      const result = await db('token_analysis_history')
        .where('token_address', tokenAddress)
        .where('analyzed_at', '>', cutoffTime)
        .orderBy('analyzed_at', 'desc')
        .first();

      return result;
    } catch (error) {
      logger.error('Failed to get recent analysis:', error);
      return null;
    }
  }

  async getTopTokensForReanalysis(limit: number): Promise<any[]> {
    try {
      // Get high-scoring tokens that haven't been analyzed recently
      const oneHourAgo = new Date(Date.now() - 3600000);
      
      const tokens = await db('tokens')
        .leftJoin(
          db('token_analysis_history')
            .select('token_address')
            .max('analyzed_at as last_analyzed')
            .groupBy('token_address')
            .as('latest'),
          'tokens.address',
          'latest.token_address'
        )
        .where('tokens.composite_score', '>', 0.6)
        .where(function() {
          this.whereNull('latest.last_analyzed')
            .orWhere('latest.last_analyzed', '<', oneHourAgo);
        })
        .orderBy('tokens.composite_score', 'desc')
        .limit(limit)
        .select(
          'tokens.address',
          'tokens.symbol',
          'tokens.name',
          'tokens.platform',
          'tokens.created_at',
          'latest.last_analyzed'
        );

      return tokens;
    } catch (error) {
      logger.error('Failed to get tokens for reanalysis:', error);
      return [];
    }
  }

  async getAnalysisHistory(tokenAddress: string, limit: number = 10): Promise<any[]> {
    try {
      const history = await db('token_analysis_history')
        .where('token_address', tokenAddress)
        .orderBy('analyzed_at', 'desc')
        .limit(limit);

      return history;
    } catch (error) {
      logger.error('Failed to get analysis history:', error);
      return [];
    }
  }

  private classifyInvestment(score: number): string {
    if (score >= 0.8) return 'HOT';
    if (score >= 0.6) return 'PROMISING';
    if (score >= 0.4) return 'MODERATE';
    if (score >= 0.2) return 'RISKY';
    return 'AVOID';
  }

  async getTokenStats(): Promise<any> {
    try {
      const stats = await db('tokens')
        .select('analysis_status')
        .count('* as count')
        .groupBy('analysis_status');

      const classifications = await db('tokens')
        .select('investment_classification')
        .count('* as count')
        .whereNotNull('investment_classification')
        .groupBy('investment_classification');

      return {
        byStatus: stats,
        byClassification: classifications,
      };
    } catch (error) {
      logger.error('Failed to get token stats:', error);
      return { byStatus: [], byClassification: [] };
    }
  }
}

