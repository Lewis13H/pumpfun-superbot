import { db } from '../src/database/postgres';
import { analysisService } from '../src/analysis/analysis-service';
import { logger } from '../src/utils/logger';

async function analyzePending() {
  // Get pending tokens
  const pendingTokens = await db('tokens')
    .where('analysis_status', 'PENDING')
    .orderBy('discovered_at', 'desc')
    .limit(10)
    .select('address', 'symbol', 'name', 'platform', 'created_at');
    
  logger.info(`Found ${pendingTokens.length} pending tokens to analyze`);
  
  // Get the orchestrator (a bit hacky but works for testing)
  const orchestrator = (analysisService as any).orchestrator;
  
  for (const token of pendingTokens) {
    logger.info(`Queueing ${token.symbol} for analysis`);
    await orchestrator.queueTokenForAnalysis({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: token.platform,
      createdAt: new Date(token.created_at),
    }, 80); // High priority
  }
  
  logger.info('Tokens queued, waiting for analysis to complete...');
  
  // Wait a bit for processing
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check results
  const results = await db('tokens')
    .whereIn('address', pendingTokens.map(t => t.address))
    .select('symbol', 'analysis_status', 'composite_score', 'investment_classification');
    
  logger.info('Analysis results:', results);
  
  process.exit(0);
}

analyzePending().catch(console.error);