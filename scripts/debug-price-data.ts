import { DexScreenerClient } from '../src/api/dexscreener-client';
import { db } from '../src/database/postgres';

async function debugPriceData() {
  console.log('=== Debugging Price Data ===\n');
  
  // Test DexScreener API
  const dexScreener = new DexScreenerClient();
  
  // Get a recent token
  const recentToken = await db('tokens')
    .whereNotNull('address')
    .orderBy('discovered_at', 'desc')
    .first();
    
  if (recentToken) {
    console.log(`Testing with token: ${recentToken.symbol} (${recentToken.address})`);
    
    try {
      const pairs = await dexScreener.getTokenPairs(recentToken.address);
      console.log('\nDexScreener response:');
      
      if (pairs && pairs.length > 0) {
        const pair = pairs[0];
        console.log({
          priceUsd: pair.priceUsd,
          fdv: pair.fdv,
          liquidity: pair.liquidity,
          volume24h: pair.volume24h
        });
      } else {
        console.log('No pairs found on DexScreener');
      }
    } catch (error) {
      console.error('DexScreener error:', error);
    }
  }
  
  // Check recent tokens with/without prices
  const priceStats = await db('tokens')
    .select(
      db.raw('COUNT(*) FILTER (WHERE current_price IS NULL) as null_prices'),
      db.raw('COUNT(*) FILTER (WHERE current_price = 0) as zero_prices'),
      db.raw('COUNT(*) FILTER (WHERE current_price > 0) as valid_prices'),
      db.raw('COUNT(*) as total')
    )
    .where('discovered_at', '>', new Date(Date.now() - 3600000))
    .first();
    
  console.log('\nPrice statistics (last hour):');
  console.table(priceStats);
}

debugPriceData();
