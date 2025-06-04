import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';

async function fixFailedTokens() {
  console.log('=== Fixing Failed Tokens (Moving to ARCHIVE) ===\n');
  
  // 1. Find all tokens with $0 market cap not in ARCHIVE/BIN
  console.log('1. Finding failed tokens ($0 market cap)...\n');
  
  const failedTokens = await db('tokens')
    .where('market_cap', 0)
    .orWhereNull('market_cap')
    .whereNotIn('category', ['ARCHIVE', 'BIN'])
    .select('address', 'symbol', 'category', 'market_cap', 'created_at');
  
  console.log(`Found ${failedTokens.length} failed tokens not in ARCHIVE\n`);
  
  // Show examples
  console.log('Examples:');
  const examples = failedTokens.slice(0, 10);
  examples.forEach(t => {
    const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60));
    console.log(`  ${t.symbol || t.address.slice(0, 8)}: ${t.category} → ARCHIVE (age: ${age}h)`);
  });
  
  if (failedTokens.length > examples.length) {
    console.log(`  ... and ${failedTokens.length - examples.length} more`);
  }
  
  // 2. Move them to ARCHIVE
  console.log('\n2. Moving failed tokens to ARCHIVE...');
  
  const batchSize = 100;
  let moved = 0;
  
  for (let i = 0; i < failedTokens.length; i += batchSize) {
    const batch = failedTokens.slice(i, i + batchSize);
    
    // Update database
    await db('tokens')
      .whereIn('address', batch.map(t => t.address))
      .update({
        category: 'ARCHIVE',
        category_updated_at: new Date(),
        previous_category: db.raw('category')
      });
    
    // Record transitions
    for (const token of batch) {
      await db('category_transitions').insert({
        token_address: token.address,
        from_category: token.category,
        to_category: 'ARCHIVE',
        market_cap_at_transition: 0,
        reason: 'zero_market_cap',
        metadata: { fixed_by: 'fix_failed_tokens_script' }
      });
      
      // Update state machine if exists
      try {
        const machines = (categoryManager as any).machines;
        if (machines.has(token.address)) {
          const machine = machines.get(token.address);
          machine.stop();
          machines.delete(token.address);
          (categoryManager as any).stateCache.delete(token.address);
        }
      } catch (error) {
        // Ignore state machine errors
      }
    }
    
    moved += batch.length;
    console.log(`  Moved ${moved}/${failedTokens.length} tokens...`);
  }
  
  console.log(`\n✅ Moved ${moved} failed tokens to ARCHIVE`);
  
  // 3. Fix any tokens in wrong categories based on market cap
  console.log('\n3. Checking for other miscategorized tokens...\n');
  
  const wrongCategories = await db.raw(`
    SELECT category, COUNT(*) as count
    FROM tokens
    WHERE category NOT IN ('BIN', 'ARCHIVE')
    AND (
      (market_cap >= 0 AND market_cap < 8000 AND category NOT IN ('LOW', 'NEW')) OR
      (market_cap >= 8000 AND market_cap < 19000 AND category != 'MEDIUM') OR
      (market_cap >= 19000 AND market_cap < 35000 AND category != 'HIGH') OR
      (market_cap >= 35000 AND market_cap <= 105000 AND category != 'AIM') OR
      (market_cap > 105000 AND category != 'AIM')
    )
    GROUP BY category
  `);
  
  if (wrongCategories.rows.length > 0) {
    console.log('Found tokens in wrong categories:');
    console.table(wrongCategories.rows);
  } else {
    console.log('✅ All remaining tokens are in correct categories');
  }
  
  // 4. Clean up invalid transitions
  console.log('\n4. Cleaning up invalid transitions...\n');
  
  // Delete transitions to AIM with low market cap
  const invalidAim = await db('category_transitions')
    .where('to_category', 'AIM')
    .where('market_cap_at_transition', '<', 35000)
    .delete();
  
  console.log(`  Deleted ${invalidAim} invalid transitions to AIM`);
  
  // 5. Show final distribution
  console.log('\n5. Final category distribution:\n');
  
  const distribution = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category')
    .orderBy('category');
  
  console.table(distribution);
  
  // 6. NEW tokens check
  console.log('\n6. Checking NEW tokens...\n');
  
  const newTokens = await db('tokens')
    .where('category', 'NEW')
    .select('symbol', 'market_cap', 'created_at')
    .orderBy('created_at', 'desc')
    .limit(5);
  
  if (newTokens.length > 0) {
    console.log('Recent NEW tokens (should be recently discovered):');
    newTokens.forEach(t => {
      const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60));
      console.log(`  ${t.symbol}: $${t.market_cap || 0} (${age} min old)`);
    });
  }
}

// Run with confirmation
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('This will:');
console.log('- Move all $0 market cap tokens to ARCHIVE');
console.log('- Fix any remaining miscategorized tokens');
console.log('- Clean up invalid transitions');
readline.question('\nContinue? (yes/no): ', (answer: string) => {
  if (answer.toLowerCase() === 'yes') {
    fixFailedTokens()
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