import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';

async function verifyBehavior() {
  console.log('=== Verifying Discovery Behavior ===\n');
  
  // 1. Check save rate (should be 100%)
  const totalTokens = await db('tokens')
    .where('discovered_at', '>', new Date(Date.now() - 5 * 60 * 1000))
    .count('* as count')
    .first();
  
  console.log(`Tokens discovered in last 5 minutes: ${totalTokens?.count || 0}`);
  
  // 2. Check category assignment
  const categoryDist = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category');
  
  console.log('\nCategory Distribution:');
  console.table(categoryDist);
  
  // 3. Check state machines
  const stats = categoryManager.getStats();
  console.log(`\nActive State Machines: ${stats.activeMachines}`);
  
  // 4. Check for pump.fun specific data
  const pumpfunTokens = await db('tokens')
    .where('platform', 'pumpfun')
    .whereNotNull('bonding_curve')
    .count('* as count')
    .first();
  
  console.log(`\nPump.fun tokens with metadata: ${pumpfunTokens?.count || 0}`);
  
  // 5. Check for proper market cap categorization
  const wrongCategories = await db('tokens')
    .where(function() {
      this.where('category', 'LOW').where('market_cap', '>=', 8000)
        .orWhere('category', 'MEDIUM').where('market_cap', '>=', 19000)
        .orWhere('category', 'HIGH').where('market_cap', '>=', 35000);
    })
    .select('symbol', 'category', 'market_cap');
  
  if (wrongCategories.length > 0) {
    console.log('\n⚠️ Tokens in wrong categories:');
    console.table(wrongCategories);
  } else {
    console.log('\n✅ All tokens correctly categorized');
  }
}

verifyBehavior()
  .then(() => process.exit(0))
  .catch(console.error);