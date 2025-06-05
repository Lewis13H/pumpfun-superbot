// scripts/fix-graduated-tokens.js
const { db } = require('../dist/database/postgres');
const axios = require('axios');
const { logger } = require('../dist/utils/logger');

async function fixGraduatedTokens() {
  console.log('🔧 Fixing graduated tokens stuck at $69k...');
  
  try {
    // Find tokens that are graduated and stuck around $69k
    const stuckTokens = await db('tokens')
      .where(function() {
        this.where('curve_progress', '>=', 0.99)
          .orWhere(function() {
            this.where('market_cap', '>=', 68000)
              .where('market_cap', '<=', 70000);
          });
      })
      .select('address', 'symbol', 'curve_progress', 'market_cap', 'bonding_curve');
    
    console.log(`Found ${stuckTokens.length} tokens potentially stuck at graduation`);
    
    let fixed = 0;
    let errors = 0;
    
    for (const token of stuckTokens) {
      try {
        console.log(`\nChecking ${token.symbol} (${token.address})...`);
        console.log(`  Current MC: $${token.market_cap}, Progress: ${token.curve_progress}`);
        
        // Fetch real market cap from DexScreener
        const response = await axios.get(
          `https://api.dexscreener.com/latest/dex/tokens/${token.address}`,
          { timeout: 10000 }
        );
        
        if (response.data.pairs && response.data.pairs.length > 0) {
          const pair = response.data.pairs[0];
          
          // Log the structure to understand the API response
          console.log(`  📋 DexScreener response structure:`);
          console.log(`     fdv: ${typeof pair.fdv} = ${pair.fdv}`);
          console.log(`     liquidity: ${typeof pair.liquidity} = ${JSON.stringify(pair.liquidity)}`);
          console.log(`     volume: ${typeof pair.volume} = ${JSON.stringify(pair.volume)}`);
          
          // Extract values based on actual API response structure
          const realMarketCap = pair.fdv || 0;
          
          // Handle liquidity - could be number or object
          let liquidity = 0;
          if (typeof pair.liquidity === 'object' && pair.liquidity?.usd) {
            liquidity = parseFloat(pair.liquidity.usd);
          } else if (typeof pair.liquidity === 'number') {
            liquidity = pair.liquidity;
          }
          
          // Handle volume - could be volume24h or volume.h24
          let volume24h = 0;
          if (pair.volume && typeof pair.volume === 'object' && pair.volume.h24) {
            volume24h = parseFloat(pair.volume.h24);
          } else if (pair.volume24h) {
            volume24h = pair.volume24h;
          }
          
          console.log(`  📊 Extracted values:`);
          console.log(`     Market Cap: $${realMarketCap.toLocaleString()}`);
          console.log(`     Liquidity: $${liquidity.toLocaleString()}`);
          console.log(`     Volume 24h: $${volume24h.toLocaleString()}`);
          
          // Only update if the real market cap is different
          if (Math.abs(realMarketCap - token.market_cap) > 100) {
            console.log(`  ✅ ${token.symbol}: Updating from $${token.market_cap.toLocaleString()} to $${realMarketCap.toLocaleString()}`);
            
            await db('tokens')
              .where('address', token.address)
              .update({
                market_cap: realMarketCap,
                liquidity: liquidity,
                volume_24h: volume24h,
                curve_progress: 1, // Ensure it's marked as fully graduated
                last_scan_at: new Date(),
                updated_at: new Date()
              });
            
            fixed++;
          } else {
            console.log(`  ⏭️  ${token.symbol}: Market cap already correct ($${realMarketCap})`);
          }
        } else {
          console.log(`  ⚠️  ${token.symbol}: No DEX pairs found`);
        }
        
        // Rate limit to avoid overwhelming DexScreener
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`  ❌ Error fixing ${token.symbol}:`, error.message);
        if (error.response?.data) {
          console.error(`     API Response:`, error.response.data);
        }
        errors++;
        
        // If it's a timeout or network error, wait longer
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`  Total tokens checked: ${stuckTokens.length}`);
    console.log(`  Fixed: ${fixed}`);
    console.log(`  Errors: ${errors}`);
    
    // Also log tokens still in AIM category with high market caps
    const aimTokens = await db('tokens')
      .where('category', 'AIM')
      .where('market_cap', '>', 100000)
      .select('symbol', 'market_cap')
      .orderBy('market_cap', 'desc')
      .limit(10);
    
    if (aimTokens.length > 0) {
      console.log('\n📈 Top AIM tokens by market cap:');
      aimTokens.forEach(token => {
        console.log(`  ${token.symbol}: $${token.market_cap.toLocaleString()}`);
      });
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    console.log('\n✅ Graduated tokens fix complete');
    process.exit(0);
  }
}

// Run the fix
fixGraduatedTokens().catch(console.error);