import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import { categoryAPIRouter } from '../src/analysis/category-api-router';

async function healthCheck() {
  console.log('=== System Health Check ===\n');
  
  const issues: string[] = [];
  
  // Check database connection
  try {
    await db.raw('SELECT 1');
    console.log('✅ Database connection: OK');
  } catch (error) {
    console.log('❌ Database connection: FAILED');
    issues.push('Database connection failed');
  }
  
  // Check category manager
  const cmStats = categoryManager.getStats();
  console.log(`✅ Category Manager: ${cmStats.activeMachines} active machines`);
  
  // Check scan scheduler
  const scanStats = scanScheduler.getStats();
  let totalActive = 0;
  Object.values(scanStats).forEach((s: any) => {
    totalActive += s.activeScans || 0;
  });
  console.log(`✅ Scan Scheduler: ${totalActive} active scans`);
  
  // Check for stuck tokens
  const stuckTokens = await db('tokens')
    .whereNotIn('category', ['BIN', 'ARCHIVE'])
    .where('updated_at', '<', new Date(Date.now() - 2 * 60 * 60 * 1000)) // 2 hours
    .count('* as count')
    .first();
  
  if (Number(stuckTokens?.count) > 0) {
    console.log(`⚠️  Stuck Tokens: ${stuckTokens?.count} tokens not updated in 2+ hours`);
    issues.push(`${stuckTokens?.count} stuck tokens`);
  } else {
    console.log('✅ Stuck Tokens: None');
  }
  
  // Check API budget
  const apiStats = categoryAPIRouter.getApiStats();
  if (apiStats.dailyCost > 18) {
    console.log(`⚠️  API Budget: ${apiStats.dailyCost.toFixed(2)}/day (approaching limit)`);
    issues.push('API budget warning');
  } else {
    console.log(`✅ API Budget: ${apiStats.dailyCost.toFixed(2)}/day`);
  }
  
  // Check for tokens in wrong categories
  const wrongCategory = await db('tokens')
    .where(function() {
      this.where('category', 'LOW').where('market_cap', '>=', 8000)
        .orWhere('category', 'MEDIUM').where('market_cap', '>=', 19000)
        .orWhere('category', 'HIGH').where('market_cap', '>=', 35000);
    })
    .count('* as count')
    .first();
  
  if (Number(wrongCategory?.count) > 0) {
    console.log(`⚠️  Wrong Categories: ${wrongCategory?.count} tokens in wrong category`);
    issues.push(`${wrongCategory?.count} tokens in wrong category`);
  } else {
    console.log('✅ Category Assignment: All correct');
  }
  
  // Summary
  console.log('\n\nHealth Check Summary:');
  if (issues.length === 0) {
    console.log('✅ All systems operational');
  } else {
    console.log(`⚠️  ${issues.length} issues found:`);
    issues.forEach(issue => console.log(`   - ${issue}`));
  }
}

healthCheck()
  .then(() => process.exit(0))
  .catch(console.error);

