import { analysisService } from '../src/analysis/analysis-service';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function reanalyzeTokens() {
  console.log('\n🔄 Re-analyzing Tokens with API Data\n');

  // Start the analysis service
  await analysisService.start();

  // Get tokens to re-analyze
  const tokens = await db('tokens')
    .select('address', 'symbol', 'name')
    .whereIn('analysis_status', ['COMPLETED', 'FAILED'])
    .orderBy('discovered_at', 'desc')
    .limit(10);

  console.log(`Found ${tokens.length} tokens to re-analyze\n`);

  for (const token of tokens) {
    console.log(`📊 Queueing ${token.symbol || token.address.slice(0, 8)}...`);
    try {
      await analysisService.reanalyzeToken(token.address);
      console.log(`   ✅ Queued for analysis`);
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // Wait for analyses to complete
  console.log('\n⏳ Waiting for analyses to complete...');
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

  // Check results
  console.log('\n📈 Analysis Results:\n');
  const results = await db('tokens')
    .select('symbol', 'name', 'composite_score', 'investment_classification', 'price', 'market_cap')
    .whereIn('address', tokens.map(t => t.address))
    .orderBy('composite_score', 'desc');

  for (const result of results) {
    if (result.composite_score !== null) {
      const emoji = 
        result.investment_classification === 'STRONG_BUY' ? '🚀' :
        result.investment_classification === 'BUY' ? '📈' :
        result.investment_classification === 'CONSIDER' ? '🤔' :
        result.investment_classification === 'MONITOR' ? '👀' :
        result.investment_classification === 'HIGH_RISK' ? '⚠️' : '❌';
      
      console.log(`${emoji} ${result.symbol || 'Unknown'}: Score ${(result.composite_score * 100).toFixed(1)}% - ${result.investment_classification}`);
      if (result.price > 0) {
        console.log(`   💰 Price: $${result.price.toFixed(8)}, Market Cap: $${result.market_cap?.toLocaleString() || '0'}`);
      }
    }
  }

  // Stop the service
  await analysisService.stop();
  console.log('\n✅ Re-analysis Complete\n');
}

// Run the re-analysis
reanalyzeTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Re-analysis failed:', error);
    process.exit(1);
  });