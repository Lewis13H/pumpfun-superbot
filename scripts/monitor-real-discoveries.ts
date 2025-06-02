import { db } from '../src/database/postgres';

async function monitorRealDiscoveries() {
  console.log('=== Monitoring Real Token Discoveries ===\n');
  
  let lastCount = await db('tokens').count('* as count').first();
  let lastCountValue = Number(lastCount?.count || 0);
  
  setInterval(async () => {
    const currentCount = await db('tokens').count('* as count').first();
    const currentCountValue = Number(currentCount?.count || 0);
    
    if (currentCountValue > lastCountValue) {
      const newTokens = await db('tokens')
        .orderBy('discovered_at', 'desc')
        .limit(currentCountValue - lastCountValue)
        .select('symbol', 'address', 'category', 'market_cap', 'current_price', 'platform');
      
      console.log(`\n🆕 ${newTokens.length} new tokens discovered:`);
      newTokens.forEach(token => {
        console.log(`  ${token.symbol} - ${token.category} - MC: $${token.market_cap || 0} - Price: $${token.current_price || 0} - Platform: ${token.platform}`);
      });
      
      lastCountValue = currentCountValue;
    }
  }, 5000);
  
  console.log(`Starting with ${lastCountValue} tokens. Watching for new discoveries...`);
}

monitorRealDiscoveries();
