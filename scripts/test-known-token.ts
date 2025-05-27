import { TokenAnalyzer } from '../src/analysis/token-analyzer';
import { db } from '../src/database/postgres';

async function testKnownToken() {
  console.log('\n🧪 Testing with Known Memecoins\n');

  const knownTokens = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin' },
    { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', name: 'Popcat' },
    { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat' }
  ];

  const analyzer = new TokenAnalyzer();

  for (const token of knownTokens.slice(0, 2)) { // Test first 2
    console.log(`\n🔍 Testing ${token.symbol}...`);
    
    try {
      // Ensure token is in database
      await db('tokens').insert({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: 'test',
        created_at: new Date(Date.now() - 86400000), // 1 day old
        discovered_at: new Date(),
        analysis_status: 'PENDING'
      }).onConflict('address').merge();

      // Analyze
      const result = await analyzer.analyzeToken(token.address);
      
      console.log(`  ✅ Analysis complete!`);
      console.log(`  💰 Price: $${result.price}`);
      console.log(`  📊 Market Cap: $${result.marketCap.toLocaleString()}`);
      console.log(`  💧 24h Volume: $${result.volume24h.toLocaleString()}`);
      console.log(`  🎯 Score: ${(result.compositeScore * 100).toFixed(1)}%`);
      console.log(`  📈 Classification: ${result.classification}`);
      
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    // Wait between tokens
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log('\n✅ Test complete!\n');
}

testKnownToken()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });