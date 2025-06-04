import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';

async function checkSystemStatus() {
  console.log('=== System Status Check ===\n');
  
  // 1. Category distribution
  const distribution = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category')
    .orderBy('category');
  
  console.log('Token Distribution:');
  console.table(distribution);
  
  // 2. Check tokens close to next category
  console.log('\nTokens Close to Category Change:');
  
  // HIGH tokens close to AIM ($35k)
  const nearAim = await db('tokens')
    .where('category', 'HIGH')
    .where('market_cap', '>', 30000)
    .select('symbol', 'market_cap')
    .orderBy('market_cap', 'desc');
  
  if (nearAim.length > 0) {
    console.log('\nHIGH → AIM candidates:');
    nearAim.forEach(t => {
      const progress = ((Number(t.market_cap) / 35000) * 100).toFixed(1);
      console.log(`  ${t.symbol}: $${t.market_cap} (${progress}% to AIM)`);
    });
  }
  
  // MEDIUM tokens close to HIGH ($19k)
  const nearHigh = await db('tokens')
    .where('category', 'MEDIUM')
    .where('market_cap', '>', 17000)
    .select('symbol', 'market_cap')
    .orderBy('market_cap', 'desc');
  
  if (nearHigh.length > 0) {
    console.log('\nMEDIUM → HIGH candidates:');
    nearHigh.forEach(t => {
      const progress = ((Number(t.market_cap) / 19000) * 100).toFixed(1);
      console.log(`  ${t.symbol}: $${t.market_cap} (${progress}% to HIGH)`);
    });
  }
  
  // 3. All HIGH and MEDIUM tokens
  console.log('\nAll HIGH tokens:');
  const highTokens = await db('tokens')
    .where('category', 'HIGH')
    .select('symbol', 'market_cap', 'liquidity', 'holders')
    .orderBy('market_cap', 'desc');
  
  highTokens.forEach(t => {
    console.log(`  ${t.symbol}: $${t.market_cap} (Liq: $${t.liquidity}, Holders: ${t.holders || 'N/A'})`);
  });
  
  console.log('\nAll MEDIUM tokens:');
  const mediumTokens = await db('tokens')
    .where('category', 'MEDIUM')
    .select('symbol', 'market_cap', 'liquidity', 'holders')
    .orderBy('market_cap', 'desc');
  
  mediumTokens.forEach(t => {
    console.log(`  ${t.symbol}: $${t.market_cap} (Liq: $${t.liquidity}, Holders: ${t.holders || 'N/A'})`);
  });
  
  // 4. Recent activity
  const recentScans = await db('scan_logs')
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000))
    .count('* as count')
    .first();
  
  console.log(`\nRecent Activity:`);
  console.log(`  Scans in last 30 min: ${recentScans?.count || 0}`);
  
  // 5. State machine status
  const cmStats = categoryManager.getStats();
  console.log(`  Active state machines: ${cmStats.activeMachines}`);
  
  // 6. Scan scheduler status
  const scanStats = scanScheduler.getStats();
  let totalScheduled = 0;
  Object.values(scanStats).forEach((stats: any) => {
    totalScheduled += stats.totalTasks || 0;
  });
  console.log(`  Scheduled scan tasks: ${totalScheduled}`);
}

checkSystemStatus()
  .then(() => process.exit(0))
  .catch(console.error);