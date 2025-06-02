import { db } from '../src/database/postgres';

async function checkMediumTokens() {
  const mediumTokens = await db('tokens')
    .where('category', 'MEDIUM')
    .orderBy('market_cap', 'desc')
    .select('symbol', 'market_cap');
    
  console.log('\nMEDIUM tokens ($8k-$19k):');
  mediumTokens.forEach(t => {
    const marketCap = Number(t.market_cap) || 0;
    const progressToHigh = ((marketCap - 8000) / 11000) * 100;
    console.log(`  ${t.symbol}: $${marketCap.toFixed(2)} (${progressToHigh.toFixed(1)}% to HIGH)`);
  });
  
  // Also show the closest to HIGH
  const topToken = mediumTokens[0];
  if (topToken) {
    const topMarketCap = Number(topToken.market_cap);
    const distanceToHigh = 19000 - topMarketCap;
    console.log(`\nClosest to HIGH: ${topToken.symbol} needs $${distanceToHigh.toFixed(2)} more`);
  }
  
  process.exit(0);
}

checkMediumTokens();
