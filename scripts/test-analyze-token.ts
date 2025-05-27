import { TokenAnalyzer } from '../src/analysis/token-analyzer';
import { logger } from '../src/utils/logger';
import { db } from '../src/database/postgres';

async function testAnalyzeToken() {
  console.log('\n🔍 Testing Token Analysis\n');

  const analyzer = new TokenAnalyzer();

  // Test 1: Analyze a known token (BONK)
  console.log('1️⃣ Analyzing BONK...');
  try {
    const bonk = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    
    // First, ensure BONK is in the database
    await db('tokens').insert({
      address: bonk,
      symbol: 'BONK',
      name: 'Bonk',
      platform: 'test',
      created_at: new Date(),
      discovered_at: new Date(),
      analysis_status: 'PENDING'
    }).onConflict('address').merge();

    // Analyze it
    const result = await analyzer.analyzeToken(bonk);
    
    console.log(`   ✅ Analysis complete!`);
    console.log(`   📊 Scores:`);
    console.log(`      - Safety: ${(result.safetyScore * 100).toFixed(1)}%`);
    console.log(`      - Liquidity: ${(result.liquidityScore * 100).toFixed(1)}%`);
    console.log(`      - Community: ${(result.communityScore * 100).toFixed(1)}%`);
    console.log(`      - Momentum: ${(result.momentumScore * 100).toFixed(1)}%`);
    console.log(`      - Potential: ${(result.potentialScore * 100).toFixed(1)}%`);
    console.log(`   🎯 Composite Score: ${(result.compositeScore * 100).toFixed(1)}%`);
    console.log(`   📈 Classification: ${result.classification}`);
    console.log(`   💰 Price: $${result.price}`);
    console.log(`   📊 Market Cap: $${result.marketCap.toLocaleString()}`);
    console.log(`   💧 24h Volume: $${result.volume24h.toLocaleString()}`);
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 2: Check a recently discovered token
  console.log('\n2️⃣ Checking Recently Discovered Token...');
  try {
    const recent = await db('tokens')
      .select('address', 'symbol', 'composite_score', 'investment_classification')
      .where('platform', 'pumpfun')
      .orderBy('discovered_at', 'desc')
      .first();

    if (recent && recent.composite_score !== null) {
      console.log(`   📍 ${recent.symbol} (${recent.address.slice(0, 8)}...)`);
      console.log(`   📊 Score: ${(recent.composite_score * 100).toFixed(1)}%`);
      console.log(`   📈 Classification: ${recent.investment_classification}`);
      
      // Try to analyze it with real data
      console.log('   🔄 Re-analyzing with current data...');
      const result = await analyzer.analyzeToken(recent.address);
      
      if (result.price > 0) {
        console.log(`   ✅ Found on DEX!`);
        console.log(`   💰 Price: $${result.price.toFixed(8)}`);
        console.log(`   📊 New Score: ${(result.compositeScore * 100).toFixed(1)}%`);
        console.log(`   📈 New Classification: ${result.classification}`);
      } else {
        console.log(`   ⏳ Still not on DEX`);
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n✅ Analysis Test Complete\n');
}

// Run the test
testAnalyzeToken()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });