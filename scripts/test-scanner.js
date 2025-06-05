// scripts/test-scanner.js
const { db } = require('../dist/database/postgres');
const { DexScreenerClient } = require('../dist/api/dexscreener-client');
const { BirdeyeClient } = require('../dist/api/birdeye-client');

async function testScanner() {
  console.log('🔍 Testing scanner functionality...\n');
  
  const dexscreener = new DexScreenerClient();
  const birdeye = new BirdeyeClient(process.env.BIRDEYE_API_KEY || '');
  
  try {
    // Get a few tokens to test
    const tokens = await db('tokens')
      .where('category', 'LOW')
      .orderBy(db.raw('RANDOM()'))
      .limit(5)
      .select('address', 'symbol', 'market_cap', 'category');
    
    console.log(`Found ${tokens.length} tokens to test:\n`);
    
    for (const token of tokens) {
      console.log(`\n📊 Testing ${token.symbol} (${token.address})`);
      console.log(`   Current: $${token.market_cap} in ${token.category}`);
      
      try {
        // Try DexScreener
        const pairs = await dexscreener.getTokenPairs(token.address);
        if (pairs && pairs.length > 0) {
          const pair = pairs[0];
          console.log(`   DexScreener: $${pair.fdv || 0} MC, $${pair.liquidity?.usd || 0} Liq`);
          
          // Update in database
          const newMarketCap = pair.fdv || 0;
          if (newMarketCap > 0) {
            await db('tokens')
              .where('address', token.address)
              .update({
                market_cap: newMarketCap,
                liquidity: pair.liquidity?.usd || 0,
                volume_24h: pair.volume?.h24 || 0,
                last_scan_at: new Date(),
                updated_at: new Date()
              });
            
            // Check new category
            const updated = await db('tokens')
              .where('address', token.address)
              .select('category', 'market_cap')
              .first();
            
            console.log(`   ✅ Updated to: $${updated.market_cap} in ${updated.category}`);
          }
        } else {
          console.log(`   ❌ No DexScreener data`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
    
    // Check category distribution after updates
    console.log('\n📈 Category Distribution After Test:');
    const distribution = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category')
      .orderBy('count', 'desc');
    
    distribution.forEach(row => {
      console.log(`   ${row.category}: ${row.count} tokens`);
    });
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    process.exit(0);
  }
}

testScanner().catch(console.error);
