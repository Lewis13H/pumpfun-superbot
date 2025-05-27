import { db } from '../src/database/postgres';
import { analysisService } from '../src/analysis/analysis-service';

async function reanalyzeOldCompleted() {
  console.log('\n🔄 Re-analyzing Old Completed Tokens with New API System\n');

  // Get tokens that were analyzed with the old system
  // These will have low scores and no real price data
  const oldTokens = await db('tokens')
    .select('address', 'symbol', 'name', 'composite_score', 'price')
    .where('analysis_status', 'COMPLETED')
    .where(function() {
      this.where('price', 0)
        .orWhereNull('price')
        .orWhere('composite_score', '<', 0.6)
    })
    .orderBy('discovered_at', 'desc')
    .limit(20); // Process 20 at a time

  console.log(`Found ${oldTokens.length} tokens that need re-analysis with API data\n`);

  if (oldTokens.length === 0) {
    console.log('All tokens have been analyzed with the new system! 🎉');
    return;
  }

  // Reset these tokens to PENDING
  const addresses = oldTokens.map(t => t.address);
  await db('tokens')
    .whereIn('address', addresses)
    .update({
      analysis_status: 'PENDING',
      updated_at: new Date()
    });

  console.log('✅ Reset tokens to PENDING status\n');

  // Start the analysis service
  await analysisService.start();

  // Queue them for analysis
  for (const token of oldTokens) {
    console.log(`📊 Queueing ${token.symbol || token.address.slice(0, 8)}...`);
    try {
      await analysisService.reanalyzeToken(token.address);
      console.log(`   ✅ Queued for analysis`);
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // Wait for analyses to complete
  console.log('\n⏳ Waiting for analyses to complete (20 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 20000)); // Wait 20 seconds

  // Check results
  console.log('\n📈 Analysis Results:\n');
  const results = await db('tokens')
    .select('symbol', 'name', 'composite_score', 'investment_classification', 'price', 'market_cap')
    .whereIn('address', addresses)
    .whereNotNull('composite_score')
    .orderBy('composite_score', 'desc');

  let successCount = 0;
  for (const result of results) {
    if (result.price > 0) {
      successCount++;
      const emoji = 
        result.investment_classification === 'STRONG_BUY' ? '🚀' :
        result.investment_classification === 'BUY' ? '📈' :
        result.investment_classification === 'CONSIDER' ? '🤔' :
        result.investment_classification === 'MONITOR' ? '👀' :
        result.investment_classification === 'HIGH_RISK' ? '⚠️' : '❌';
      
      console.log(`${emoji} ${result.symbol}: Score ${(result.composite_score * 100).toFixed(1)}% - ${result.investment_classification}`);
      console.log(`   💰 Price: $${result.price.toFixed(8)}`);
    } else {
      console.log(`⏳ ${result.symbol || 'Unknown'}: Not on DEX yet`);
    }
  }

  console.log(`\n✅ Successfully re-analyzed ${successCount} tokens with API data`);
  
  // Check how many more need re-analysis
  const remaining = await db('tokens')
    .where('analysis_status', 'COMPLETED')
    .where(function() {
      this.where('price', 0).orWhereNull('price');
    })
    .count('* as count')
    .first();

  if (remaining && Number(remaining.count) > 0) {
    console.log(`\n📌 ${remaining.count} more tokens need re-analysis`);
    console.log('   Run this script again to process the next batch');
  }

  // Stop the service
  await analysisService.stop();
  console.log('\n✅ Re-analysis Complete\n');
}

// Run the re-analysis
reanalyzeOldCompleted()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Re-analysis failed:', error);
    process.exit(1);
  });