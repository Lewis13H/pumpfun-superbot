import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function checkAnalysis() {
  // Get token counts by status
  const tokensByStatus = await db('tokens')
    .select('analysis_status')
    .count('* as count')
    .groupBy('analysis_status');
    
  logger.info('Tokens by analysis status:', tokensByStatus);

  // Get recent analyses
  const recentAnalyses = await db('token_analysis_history')
    .orderBy('analyzed_at', 'desc')
    .limit(5)
    .select('token_address', 'composite_score', 'analyzed_at');
    
  logger.info('Recent analyses:', recentAnalyses);

  // Get token classifications
  const classifications = await db('tokens')
    .select('investment_classification')
    .count('* as count')
    .whereNotNull('investment_classification')
    .groupBy('investment_classification');
    
  logger.info('Token classifications:', classifications);

  process.exit(0);
}

checkAnalysis().catch(console.error);