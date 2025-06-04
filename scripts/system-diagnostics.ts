import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import { categoryConfig } from '../src/config/category-config';

async function runDiagnostics() {
  console.log('=== System Diagnostics ===\n');
  
  // 1. Check category distribution
  console.log('1. Token Category Distribution:');
  const distribution = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category')
    .orderBy('category');
  
  console.table(distribution);
  
  // 2. Check tokens without category
  const uncategorized = await db('tokens')
    .whereNull('category')
    .orWhere('category', '')
    .count('* as count')
    .first();
  
  console.log(`\n2. Uncategorized tokens: ${uncategorized?.count || 0}`);
  
  // 3. Check recently updated tokens
  const recentlyUpdated = await db('tokens')
    .where('updated_at', '>', new Date(Date.now() - 60 * 60 * 1000)) // Last hour
    .count('* as count')
    .first();
  
  console.log(`\n3. Tokens updated in last hour: ${recentlyUpdated?.count || 0}`);
  
  // 4. Check active categories (non-terminal)
  const activeTokens = await db('tokens')
    .whereNotIn('category', ['BIN', 'ARCHIVE'])
    .whereNotNull('category')
    .count('* as count')
    .first();
  
  console.log(`\n4. Active tokens (not BIN/ARCHIVE): ${activeTokens?.count || 0}`);
  
  // 5. Check state machine status
  console.log('\n5. State Machine Status:');
  const cmStats = categoryManager.getStats();
  console.log(`   Active Machines: ${cmStats.activeMachines}`);
  console.log(`   Cached States: ${cmStats.cachedStates}`);
  
  // 6. Check scan scheduler status
  console.log('\n6. Scan Scheduler Status:');
  const scanStats = scanScheduler.getStats();
  let totalTasks = 0;
  let totalActive = 0;
  
  Object.entries(scanStats).forEach(([category, stats]: [string, any]) => {
    if (stats.totalTasks > 0) {
      console.log(`   ${category}: ${stats.totalTasks} tasks, ${stats.activeScans} active`);
      totalTasks += stats.totalTasks;
      totalActive += stats.activeScans;
    }
  });
  
  console.log(`   Total: ${totalTasks} tasks, ${totalActive} active scans`);
  
  // 7. Check if services need initialization
  console.log('\n7. Service Initialization Check:');
  
  // Sample tokens that should have state machines
  const sampleTokens = await db('tokens')
    .whereNotIn('category', ['BIN', 'ARCHIVE'])
    .whereNotNull('category')
    .limit(5)
    .select('address', 'symbol', 'category', 'market_cap');
  
  console.log('\nSample active tokens:');
  sampleTokens.forEach(token => {
    const state = categoryManager.getTokenState(token.address);
    console.log(`   ${token.symbol} (${token.category}): ${state ? 'Has state machine' : 'NO STATE MACHINE'}`);
  });
  
  // 8. Check recent scans
  console.log('\n8. Recent Scan Activity:');
  const recentScans = await db('scan_logs')
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000)) // Last 30 min
    .count('* as count')
    .first();
  
  console.log(`   Scans in last 30 min: ${recentScans?.count || 0}`);
  
  // 9. Check configuration
  console.log('\n9. Configuration Check:');
  console.log(`   Categories configured: ${Object.keys(categoryConfig.scanIntervals).length}`);
  console.log(`   Buy criteria configured: ${categoryConfig.buySignalCriteria ? 'Yes' : 'No'}`);
  
  // 10. Recommendations
  console.log('\n10. Recommendations:');
  
  if (cmStats.activeMachines === 0 && Number(activeTokens?.count) > 0) {
    console.log('   ⚠️ No state machines but have active tokens - need to initialize CategoryManager');
  }
  
  if (totalTasks === 0 && Number(activeTokens?.count) > 0) {
    console.log('   ⚠️ No scheduled scans but have active tokens - need to start ScanScheduler');
  }
  
  if (Number(uncategorized?.count) > 0) {
    console.log(`   ⚠️ ${uncategorized?.count} tokens need categorization`);
  }
  
  if (Number(recentlyUpdated?.count) === 0) {
    console.log('   ⚠️ No tokens updated recently - enrichment may not be running');
  }
}

runDiagnostics()
  .then(() => process.exit(0))
  .catch(console.error);