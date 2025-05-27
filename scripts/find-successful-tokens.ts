import { db } from '../src/database/postgres';
import { apiManager } from '../src/integrations/api-manager';
import { logger } from '../src/utils/logger';

async function findSuccessfulTokens() {
  console.log('\n🎯 Finding Successful Tokens (Already on DEXes)\n');

  // Strategy: Check older FAILED and PENDING tokens that might now be on DEXes
  const candidates = await db('tokens')
    .select('address', 'symbol', 'name', 'created_at', 'analysis_status')
    .where('created_at', '<', new Date(Date.now() - 3600000)) // At least 1 hour old
    .whereIn('analysis_status', ['FAILED', 'PENDING'])
    .orderBy('created_at', 'asc') // Oldest first
    .limit(30);

  console.log(`📋 Checking ${candidates.length} older tokens for DEX presence...\n`);

  const foundTokens = [];
  let checkCount = 0;

  // Use DexScreener to quickly check which tokens are on DEXes
  for (const token of candidates) {
    checkCount++;
    process.stdout.write(`\rChecking token ${checkCount}/${candidates.length}...`);
    
    try {
      // Quick check with DexScreener (no rate limit issues)
      const tokenData = await apiManager.getTokenData(token.address);
      
      if (tokenData && tokenData.price > 0) {
        foundTokens.push({
          ...token,
          symbol: tokenData.symbol,
          name: tokenData.name,
          price: tokenData.price,
          marketCap: tokenData.marketCap,
          volume24h: tokenData.volume24h,
          liquidity: tokenData.liquidity,
          ageHours: Math.round((Date.now() - new Date(token.created_at).getTime()) / 3600000)
        });
      }
    } catch (error) {
      // Silent fail - token not found
    }
    
    // Small delay to be nice to APIs
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n\n✅ Found ${foundTokens.length} tokens on DEXes!\n`);

  if (foundTokens.length > 0) {
    // Sort by liquidity
    foundTokens.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));

    console.log('🏆 Top Tokens by Liquidity:\n');
    
    for (const token of foundTokens.slice(0, 10)) {
      console.log(`📊 ${token.symbol} (${token.name})`);
      console.log(`   💰 Price: $${token.price.toFixed(8)}`);
      console.log(`   📈 Market Cap: $${token.marketCap.toLocaleString()}`);
      console.log(`   💧 Liquidity: $${token.liquidity.toLocaleString()}`);
      console.log(`   📊 24h Volume: $${token.volume24h.toLocaleString()}`);
      console.log(`   ⏰ Age: ${token.ageHours} hours`);
      console.log(`   📍 Status: ${token.analysis_status}`);
      console.log(`   🔗 Address: ${token.address}`);
      console.log('');
    }

    // Mark these for re-analysis
    const addresses = foundTokens.map(t => t.address);
    const updated = await db('tokens')
      .whereIn('address', addresses)
      .update({
        analysis_status: 'PENDING',
        updated_at: new Date()
      });

    console.log(`\n✅ Marked ${updated} tokens for re-analysis`);
    console.log('   These will be prioritized by the analysis service\n');
  } else {
    console.log('No tokens found on DEXes yet. This could mean:');
    console.log('  1. Your tokens are too new (need more time)');
    console.log('  2. Most tokens never make it to major DEXes');
    console.log('  3. Try checking even older tokens\n');
  }
}

// Run the search
findSuccessfulTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Search failed:', error);
    process.exit(1);
  });