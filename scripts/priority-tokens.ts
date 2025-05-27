import { db } from '../src/database/postgres';
import { apiManager } from '../src/integrations/api-manager';

async function findPriorityTokens() {
  console.log('\n🎯 Finding Priority Tokens for Analysis\n');

  // Get failed tokens that might now be on DEXes
  const failedTokens = await db('tokens')
    .select('address', 'symbol', 'name', 'created_at', 'updated_at')
    .where('analysis_status', 'FAILED')
    .orderBy('created_at', 'asc') // Oldest first (more likely to be on DEX)
    .limit(20);

  console.log(`📋 Checking ${failedTokens.length} previously failed tokens...\n`);

  const priorityTokens = [];
  let foundCount = 0;

  // Use DexScreener only (to save Birdeye rate limit)
  for (const token of failedTokens) {
    const ageHours = (Date.now() - new Date(token.created_at).getTime()) / 3600000;
    
    try {
      // Quick check with DexScreener only
      const dexClient = (apiManager as any).clients.get('dexscreener');
      const data = await dexClient.getTokenData(token.address);
      
      if (data && data.price > 0) {
        foundCount++;
        priorityTokens.push({
          ...token,
          price: data.price,
          liquidity: data.liquidity,
          ageHours: Math.round(ageHours)
        });
        console.log(`✅ Found on DEX: ${data.symbol} - $${data.price.toFixed(8)}`);
      }
    } catch (error) {
      // Silent fail - token not on DEX
    }
    
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n📊 Found ${foundCount} tokens now on DEXes!\n`);

  if (priorityTokens.length > 0) {
    // Reset these for re-analysis
    const addresses = priorityTokens.map(t => t.address);
    await db('tokens')
      .whereIn('address', addresses)
      .update({
        analysis_status: 'PENDING',
        updated_at: new Date()
      });

    console.log('🔝 Top Priority Tokens:');
    priorityTokens
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 10)
      .forEach(token => {
        console.log(`  ${token.symbol || token.address.slice(0, 8)}:`);
        console.log(`    💰 Price: $${token.price.toFixed(8)}`);
        console.log(`    💧 Liquidity: $${token.liquidity.toLocaleString()}`);
        console.log(`    ⏰ Age: ${token.ageHours} hours`);
      });

    console.log('\n✅ These tokens have been marked for re-analysis');
    console.log('   They will be processed when the analysis service runs');
  }

  console.log('\n✅ Priority check complete!\n');
}

// Run the check
findPriorityTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Priority check failed:', error);
    process.exit(1);
  });