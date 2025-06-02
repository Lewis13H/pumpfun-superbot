import { BirdeyeClient } from './src/api/birdeye-client';
import { DexScreenerClient } from './src/api/dexscreener-client';
import { db } from './src/database/postgres';

async function testAPIs() {
  console.log('Testing APIs...');
  
  // Test DexScreener (free)
  const dex = new DexScreenerClient();
  try {
    const pairs = await dex.getTokenPairs('So11111111111111111111111111111111111112');
    console.log('DexScreener works:', pairs.length > 0);
  } catch (e) {
    console.log('DexScreener error:', e.message);
  }
  
  // Check database
  const result = await db('tokens')
    .select('category', db.raw('COUNT(*) as count'), db.raw('AVG(market_cap) as avg_mc'))
    .groupBy('category');
  
  console.table(result);
  
  process.exit(0);
}

testAPIs();
