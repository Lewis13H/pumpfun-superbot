import { db } from '../src/database/postgres';

async function checkBoundaries() {
  console.log('\nTokens near category boundaries:');
  
  // Near MEDIUM ($8k)
  const nearMedium = await db('tokens')
    .where('category', 'LOW')
    .where('market_cap', '>', 6000)
    .orderBy('market_cap', 'desc')
    .limit(5);
    
  if (nearMedium.length > 0) {
    console.log('\nApproaching MEDIUM ($8k):');
    nearMedium.forEach(t => {
      console.log(`  ${t.symbol}: $${t.market_cap} (${((t.market_cap/8000)*100).toFixed(1)}% to MEDIUM)`);
    });
  }
  
  process.exit(0);
}

checkBoundaries();
