import { db } from '../src/database/postgres';
import { categoryAPIRouter } from '../src/analysis/category-api-router';

async function monitorApiCosts() {
  // Get today's costs from database
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const costs = await db('api_call_logs')
    .where('timestamp', '>=', startOfDay)
    .select('service')
    .sum('cost as total_cost')
    .groupBy('service');
  
  console.clear();
  console.log('=== API Cost Monitor ===\n');
  console.log(`Date: ${new Date().toLocaleDateString()}`);
  console.log('\nCosts by Service:');
  
  let totalCost = 0;
  costs.forEach(row => {
    console.log(`  ${row.service}: $${Number(row.total_cost).toFixed(3)}`);
    totalCost += Number(row.total_cost);
  });
  
  console.log(`\nTotal Daily Cost: $${totalCost.toFixed(3)}`);
  console.log(`Budget Remaining: $${(20 - totalCost).toFixed(3)}`);
  
  // Get SolSniffer usage
  const solsnifferCalls = await db('api_call_logs')
    .where('timestamp', '>=', startOfDay)
    .where('service', 'solsniffer')
    .count('* as count')
    .first();
  
  console.log(`\nSolSniffer Calls Today: ${solsnifferCalls?.count || 0}`);
  console.log(`SolSniffer Calls Remaining: ${5000 - (Number(solsnifferCalls?.count) || 0)}/month`);
  
  // Category analysis breakdown
  const categoryAnalysis = await db('scan_logs')
    .where('created_at', '>=', startOfDay)
    .select('category')
    .count('* as count')
    .groupBy('category');
  
  console.log('\nScans by Category:');
  categoryAnalysis.forEach(row => {
    console.log(`  ${row.category}: ${row.count} scans`);
  });
  
  // Runtime stats
  const stats = categoryAPIRouter.getApiStats();
  console.log('\nRuntime Stats:');
  console.log(`  Current Session Cost: $${stats.dailyCost.toFixed(3)}`);
  console.log(`  Monthly Projection: $${stats.monthlyProjection.toFixed(2)}`);
}

// Update every 30 seconds
setInterval(monitorApiCosts, 30000);
monitorApiCosts();
