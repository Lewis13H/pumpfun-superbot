import { db } from '../src/database/postgres';
import { analysisService } from '../src/analysis/analysis-service';
import { SimpleTokenAnalyzer } from '../src/analysis/simple-analyzer';
import { logger } from '../src/utils/logger';

async function testAnalysis() {
  logger.info('Testing token analysis pipeline...');

  try {
    // Get a token from the database to analyze
    const token = await db('tokens')
      .select('*')
      .orderBy('discovered_at', 'desc')
      .first();

    if (!token) {
      logger.error('No tokens found in database');
      process.exit(1);
    }

    logger.info(`Testing analysis for token: ${token.symbol} (${token.address})`);

    // Create analyzer and test
    const analyzer = new SimpleTokenAnalyzer();
    const analysis = await analyzer.analyze({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: token.platform,
      createdAt: new Date(token.created_at),
    });

    logger.info('Analysis result:', {
      status: analysis.status,
      metrics: analysis.metrics,
      scores: analysis.scores,
    });

    // Check if analysis was stored
    const stored = await db('token_analysis_history')
      .where('token_address', token.address)
      .orderBy('analyzed_at', 'desc')
      .first();

    if (stored) {
      logger.info('Analysis stored successfully');
    }

    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run test
testAnalysis();