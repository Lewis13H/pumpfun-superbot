import { tokenEnrichmentService } from '../src/analysis/token-enrichment-service';
import { scanScheduler } from '../src/category/scan-scheduler';
import { db } from '../src/database/postgres';

async function monitorEnrichment() {
  console.clear();
  console.log('=== Token Enrichment Monitor ===\n');
  
  const stats = await tokenEnrichmentService.getStats();
  
  console.log('Scheduler Status:');
  Object.entries(stats.scanScheduler).forEach(([category, data]: [string, any]) => {
    if (data.totalTasks > 0) {
      console.log(`\n${category}:`);
      console.log(`  Active Tasks: ${data.totalTasks}`);
      console.log(`  Completed: ${data.completedScans}`);
      console.log(`  Failed: ${data.failedScans}`);
    }
  });
  
  console.log(`\nStale Tokens: ${stats.staleTokens}`);
  
  // Get recent enrichments
  const recentUpdates = await db('tokens')
    .where('updated_at', '>', new Date(Date.now() - 5 * 60 * 1000))
    .orderBy('updated_at', 'desc')
    .limit(10)
    .select('symbol', 'category', 'market_cap', 'updated_at');
  
  console.log('\nRecent Updates:');
  recentUpdates.forEach(token => {
    const age = Math.round((Date.now() - new Date(token.updated_at).getTime()) / 1000);
    console.log(`  ${token.symbol} (${token.category}): ${token.market_cap} - ${age}s ago`);
  });
  
  // Show scan frequency
  console.log('\nScan Frequencies:');
  const intervals = categoryConfig.scanIntervals;
  Object.entries(intervals).forEach(([cat, config]) => {
    if (config.interval > 0) {
      console.log(`  ${cat}: every ${config.interval}s for ${config.duration}s`);
    }
  });
}

setInterval(monitorEnrichment, 5000);
monitorEnrichment();
