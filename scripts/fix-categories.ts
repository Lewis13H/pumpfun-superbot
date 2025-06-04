import { db } from '../src/database/postgres';
import { getCategoryFromMarketCap } from '../src/config/category-utils';
import { categoryManager } from '../src/category/category-manager';

async function fixCategories() {
  console.log('=== Fixing Token Categories ===\n');
  
  // 1. Find all tokens in wrong categories
  console.log('1. Finding mismatched tokens...');
  
  const allTokens = await db('tokens')
    .whereNotIn('category', ['BIN'])
    .select('address', 'symbol', 'category', 'market_cap');
  
  let fixed = 0;
  let needsFixing = [];
  
  for (const token of allTokens) {
    const marketCap = Number(token.market_cap) || 0;
    const correctCategory = getCategoryFromMarketCap(marketCap);
    
    if (token.category !== correctCategory) {
      needsFixing.push({
        ...token,
        marketCap,
        currentCategory: token.category,
        correctCategory
      });
    }
  }
  
  console.log(`Found ${needsFixing.length} tokens in wrong categories\n`);
  
  // Show some examples
  console.log('Examples of tokens that need fixing:');
  needsFixing.slice(0, 10).forEach(token => {
    console.log(`  ${token.symbol}: ${token.currentCategory} → ${token.correctCategory} (MC: $${token.marketCap})`);
  });
  
  // 2. Fix categories
  console.log('\n2. Fixing categories...');
  
  for (const token of needsFixing) {
    // Update database
    await db('tokens')
      .where('address', token.address)
      .update({
        category: token.correctCategory,
        category_updated_at: new Date()
      });
    
    // Update state machine if exists
    try {
      const service = (categoryManager as any).machines.get(token.address);
      if (service) {
        // Force transition to correct state
        await categoryManager.updateTokenMarketCap(token.address, token.marketCap);
      }
    } catch (error) {
      // State machine might not exist, that's OK
    }
    
    fixed++;
    if (fixed % 100 === 0) {
      console.log(`  Fixed ${fixed}/${needsFixing.length} tokens...`);
    }
  }
  
  console.log(`\n✅ Fixed ${fixed} tokens`);
  
  // 3. Clean up invalid transitions
  console.log('\n3. Cleaning up invalid transitions...');
  
  // Delete transitions where market cap was 0 and went to AIM
  const deleted = await db('category_transitions')
    .where('to_category', 'AIM')
    .where('market_cap_at_transition', 0)
    .delete();
  
  console.log(`  Deleted ${deleted} invalid transitions to AIM with $0 market cap`);
  
  // 4. Show new distribution
  console.log('\n4. New category distribution:');
  
  const distribution = await db('tokens')
    .select('category')
    .count('* as count')
    .groupBy('category')
    .orderBy('category');
  
  console.table(distribution);
  
  // 5. Check if any tokens are legitimately in AIM
  console.log('\n5. Tokens that should be in AIM (>=$35k):');
  
  const shouldBeAim = await db('tokens')
    .where('market_cap', '>=', 35000)
    .where('market_cap', '<=', 105000)
    .select('symbol', 'market_cap', 'category')
    .orderBy('market_cap', 'desc')
    .limit(10);
  
  if (shouldBeAim.length === 0) {
    console.log('  No tokens currently qualify for AIM ($35k-$105k)');
  } else {
    shouldBeAim.forEach(token => {
      console.log(`  ${token.symbol}: $${token.market_cap} (currently ${token.category})`);
    });
  }
}

// Add confirmation
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('This will fix all token categories based on their current market cap.');
readline.question('Continue? (yes/no): ', (answer: string) => {
  if (answer.toLowerCase() === 'yes') {
    fixCategories()
      .then(() => {
        console.log('\n✅ Category fix complete!');
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