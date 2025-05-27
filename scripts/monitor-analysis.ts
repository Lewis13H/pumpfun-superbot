// scripts/monitor-analysis.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function monitorAnalysis() {
  console.clear();
  logger.info('📊 Token Analysis Monitor\n');

  try {
    // Get status counts
    const statusCounts = await db('tokens')
      .select('analysis_status')
      .count('* as count')
      .groupBy('analysis_status');

    logger.info('📈 Analysis Status:');
    statusCounts.forEach(({ analysis_status, count }) => {
      const emoji = 
        analysis_status === 'COMPLETED' ? '✅' :
        analysis_status === 'ANALYZING' ? '🔄' :
        analysis_status === 'FAILED' ? '❌' : '⏳';
      logger.info(`  ${emoji} ${analysis_status}: ${count}`);
    });

    // Get classification breakdown
    const classifications = await db('tokens')
      .where('analysis_status', 'COMPLETED')
      .select('investment_classification')
      .count('* as count')
      .groupBy('investment_classification');

    logger.info('\n💎 Investment Classifications:');
    classifications.forEach(({ investment_classification, count }) => {
      const emoji = 
        investment_classification === 'STRONG_BUY' ? '🚀' :
        investment_classification === 'BUY' ? '💰' :
        investment_classification === 'HOLD' ? '📊' :
        investment_classification === 'WATCH' ? '👀' : '⚠️';
      logger.info(`  ${emoji} ${investment_classification}: ${count}`);
    });

    // Get top opportunities
    const topTokens = await db('tokens')
      .where('analysis_status', 'COMPLETED')
      .orderBy('composite_score', 'desc')
      .limit(10);

    logger.info('\n🏆 Top 10 Opportunities:');
    topTokens.forEach((token, i) => {
      logger.info(`  ${i + 1}. ${token.symbol} (${token.platform})`);
      logger.info(`     Score: ${token.composite_score?.toFixed(3) || 'N/A'} | Class: ${token.investment_classification}`);
      logger.info(`     Market Cap: $${(token.market_cap || 0).toLocaleString()}`);
    });

    // Get recent analyses
    const recentAnalyses = await db('tokens')
      .where('analysis_status', 'COMPLETED')
      .orderBy('updated_at', 'desc')
      .limit(5);

    logger.info('\n🕐 Recently Analyzed:');
    recentAnalyses.forEach(token => {
      const timeSince = Date.now() - new Date(token.updated_at).getTime();
      const minutes = Math.floor(timeSince / 60000);
      logger.info(`  ${token.symbol}: ${minutes} minutes ago (Score: ${token.composite_score?.toFixed(3) || 'N/A'})`);
    });

  } catch (error) {
    logger.error('Monitor error:', error);
  }
}

// Run monitoring
async function runMonitor() {
  while (true) {
    await monitorAnalysis();
    
    // Wait 30 seconds before refreshing
    await new Promise(resolve => setTimeout(resolve, 30000));
    console.clear();
  }
}

// Start monitoring
logger.info('Starting analysis monitor (refreshes every 30 seconds)...\n');
runMonitor().catch(console.error);