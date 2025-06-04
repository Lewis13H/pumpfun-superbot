import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { getCategoryFromMarketCap } from '../src/config/category-utils';

async function fixStateMachineIssues() {
  console.log('=== Fixing State Machine Issues ===\n');
  
  // 1. First, fix all tokens in wrong categories
  console.log('1. Finding and fixing miscategorized tokens...\n');
  
  const wrongTokens = await db('tokens')
    .whereNotIn('category', ['BIN', 'ARCHIVE'])
    .select('address', 'symbol', 'category', 'market_cap');
  
  let fixed = 0;
  const toFix = [];
  
  for (const token of wrongTokens) {
    const marketCap = Number(token.market_cap) || 0;
    const correctCategory = getCategoryFromMarketCap(marketCap);
    
    if (token.category !== correctCategory) {
      toFix.push({
        address: token.address,
        symbol: token.symbol,
        currentCategory: token.category,
        correctCategory,
        marketCap
      });
    }
  }
  
  console.log(`Found ${toFix.length} tokens in wrong categories\n`);
  
  // Show examples
  console.log('Examples:');
  toFix.slice(0, 5).forEach(t => {
    console.log(`  ${t.symbol}: ${t.currentCategory} → ${t.correctCategory} (MC: $${t.marketCap})`);
  });
  
  console.log('\nFixing categories...');
  
  // Fix in batches
  const batchSize = 100;
  for (let i = 0; i < toFix.length; i += batchSize) {
    const batch = toFix.slice(i, i + batchSize);
    
    // Update database
    await Promise.all(batch.map(token => 
      db('tokens')
        .where('address', token.address)
        .update({
          category: token.correctCategory,
          category_updated_at: new Date()
        })
    ));
    
    fixed += batch.length;
    console.log(`  Fixed ${fixed}/${toFix.length} tokens...`);
  }
  
  console.log(`\n✅ Fixed ${fixed} tokens`);
  
  // 2. Clean up invalid transitions
  console.log('\n2. Cleaning up invalid transitions...\n');
  
  // Find all transitions that shouldn't have happened
  const invalidTransitions = await db('category_transitions')
    .select('*')
    .where(function() {
      // AIM with low market cap
      this.where('to_category', 'AIM').where('market_cap_at_transition', '<', 35000)
      // Or any transition with null/0 market cap that's not to NEW
      .orWhere(function() {
        this.whereIn('market_cap_at_transition', [0, null])
          .whereNot('to_category', 'NEW');
      });
    });
  
  console.log(`Found ${invalidTransitions.length} invalid transitions`);
  
  // Delete them
  if (invalidTransitions.length > 0) {
    const ids = invalidTransitions.map(t => t.id);
    await db('category_transitions')
      .whereIn('id', ids)
      .delete();
    console.log(`  Deleted ${invalidTransitions.length} invalid transitions`);
  }
  
  // 3. Reset state machines for affected tokens
  console.log('\n3. Resetting state machines...\n');
  
  // Get unique tokens that need state machine reset
  const tokensNeedingReset = [...new Set(toFix.map(t => t.address))];
  
  console.log(`Resetting ${tokensNeedingReset.length} state machines...`);
  
  for (const address of tokensNeedingReset) {
    const token = await db('tokens').where('address', address).first();
    if (token) {
      // Remove old state machine
      const machines = (categoryManager as any).machines;
      const stateCache = (categoryManager as any).stateCache;
      
      if (machines.has(address)) {
        const machine = machines.get(address);
        machine.stop();
        machines.delete(address);
        stateCache.delete(address);
      }
      
      // Create new state machine with correct category
      await categoryManager.createOrRestoreStateMachine(
        address,
        token.category,
        {
          currentMarketCap: Number(token.market_cap) || 0,
          scanCount: token.category_scan_count || 0
        }
      );
    }
  }
  
  console.log('✅ State machines reset');
  
  // 4. Show final distribution
  console.log('\n4. Final category distribution:\n');
  
  const distribution = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category')
    .orderBy('category');
  
  console.table(distribution);
  
  // 5. Verify no tokens in wrong categories
  console.log('\n5. Verification...\n');
  
  const stillWrong = await db('tokens')
    .whereNotIn('category', ['BIN', 'ARCHIVE'])
    .select('address', 'category', 'market_cap')
    .limit(100);
  
  let wrongCount = 0;
  for (const token of stillWrong) {
    const marketCap = Number(token.market_cap) || 0;
    const correctCategory = getCategoryFromMarketCap(marketCap);
    if (token.category !== correctCategory) {
      wrongCount++;
    }
  }
  
  if (wrongCount === 0) {
    console.log('✅ All tokens are now in correct categories!');
  } else {
    console.log(`⚠️  Still ${wrongCount} tokens in wrong categories`);
  }
}

// Run with confirmation
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('This will fix all miscategorized tokens and clean up invalid transitions.');
console.log('It will also reset affected state machines.');
readline.question('\nContinue? (yes/no): ', (answer: string) => {
  if (answer.toLowerCase() === 'yes') {
    fixStateMachineIssues()
      .then(() => {
        console.log('\n✅ All fixes complete!');
        readline.close();
        process.exit(0);
      })
      .catch((error) => {
        console.error('Error:', error);
        readline.close();
        process.exit(1);
      });
  } else {
    console.log('Cancelled');
    readline.close();
    process.exit(0);
  }
});