import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import { buySignalService } from '../src/trading/buy-signal-service';
import { db } from '../src/database/postgres';
import { table } from 'console';

async function monitorCategories() {
  console.clear();
  console.log('=== Category System Monitor ===');
  console.log(`Time: ${new Date().toLocaleTimeString()}\n`);
  
  // Get distribution
  const distribution = await categoryManager.getCategoryDistribution();
  
  console.log('Token Distribution:');
  console.table(distribution);
  
  // Get scan stats
  const scanStats = scanScheduler.getStats();
  console.log('\nActive Scans by Category:');
  
  const scanTable: any = {};
  Object.entries(scanStats).forEach(([cat, stats]: [string, any]) => {
    if (stats.totalTasks > 0) {
      scanTable[cat] = {
        'Active Tasks': stats.totalTasks,
        'Running': stats.activeScans,
        'Completed': stats.completedScans,
        'Failed': stats.failedScans,
      };
    }
  });
  console.table(scanTable);
  
  // Get tokens approaching AIM
  const approachingAim = await db('tokens')
    .where('category', 'HIGH')
    .where('market_cap', '>', 30000)
    .orderBy('market_cap', 'desc')
    .limit(5)
    .select('symbol', 'market_cap');
  
  if (approachingAim.length > 0) {
    console.log('\nTokens Approaching AIM ($35k):');
    approachingAim.forEach(token => {
      const progress = ((token.market_cap / 35000) * 100).toFixed(1);
      console.log(`  ${token.symbol}: $${token.market_cap} (${progress}% to AIM)`);
    });
  }
  
  // Get AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('symbol', 'market_cap', 'buy_attempts', 'solsniffer_score');
  
  if (aimTokens.length > 0) {
    console.log('\nTokens in AIM:');
    console.table(aimTokens.map(t => ({
      Symbol: t.symbol,
      'Market Cap': `$${t.market_cap}`,
      'Buy Attempts': t.buy_attempts || 0,
      'SolSniffer': t.solsniffer_score || 'N/A',
    })));
  }
  
  // Get recent transitions
  const recentTransitions = await db('category_transitions as ct')
    .join('tokens as t', 'ct.token_address', 't.address')
    .where('ct.created_at', '>', new Date(Date.now() - 30 * 60 * 1000))
    .orderBy('ct.created_at', 'desc')
    .limit(10)
    .select('t.symbol', 'ct.from_category', 'ct.to_category', 'ct.market_cap_at_transition', 'ct.created_at');
  
  if (recentTransitions.length > 0) {
    console.log('\nRecent Category Transitions (30 min):');
    console.table(recentTransitions.map(t => ({
      Symbol: t.symbol,
      Transition: `${t.from_category} → ${t.to_category}`,
      'Market Cap': `$${t.market_cap_at_transition}`,
      'Time Ago': `${Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000)}m`,
    })));
  }
  
  // Buy signal stats
  const buyStats = await buySignalService.getStats();
  console.log('\nBuy Signal Stats:');
  console.log(`  Total Evaluations: ${buyStats.totalEvaluations}`);
  console.log(`  Pass Rate: ${buyStats.passRate}`);
  console.log(`  Active Signals: ${buyStats.activeSignals}`);
  
  // Clean up database connection
  await db.destroy();
}

// Run every 5 seconds if called directly
if (require.main === module) {
  monitorCategories().catch(console.error);
} else {
  // If imported, run continuously
  setInterval(monitorCategories, 5000);
  monitorCategories();
}

export { monitorCategories };