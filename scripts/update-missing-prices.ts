import { DexScreenerClient } from '../src/api/dexscreener-client';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function updateMissingPrices() {
  console.log('=== Updating Missing Prices ===\n');
  
  const dexScreener = new DexScreenerClient();
  
  // Get tokens with missing prices
  const tokensWithoutPrices = await db('tokens')
    .whereNull('current_price')
    .orWhere('current_price', 0)
    .limit(20)
    .select('address', 'symbol');
    
  console.log(`Found ${tokensWithoutPrices.length} tokens without prices`);
  
  let updated = 0;
  
  for (const token of tokensWithoutPrices) {
    try {
      const pairs = await dexScreener.getTokenPairs(token.address);
      
      if (pairs && pairs.length > 0) {
        const pair = pairs[0];
        const price = parseFloat(pair.priceUsd?.toString() || '0');
        const marketCap = parseFloat(pair.fdv?.toString() || '0');
        const liquidity = parseFloat(pair.liquidity?.toString() || '0');
        
        if (price > 0) {
          await db('tokens')
            .where('address', token.address)
            .update({
              current_price: price,
              market_cap: marketCap || db.raw('market_cap'),
              liquidity: liquidity || db.raw('liquidity'),
              updated_at: new Date()
            });
            
          console.log(`✅ Updated ${token.symbol}: $${price}`);
          updated++;
        }
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Failed to update ${token.symbol}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  console.log(`\nUpdated ${updated} tokens with prices`);
}

updateMissingPrices();
