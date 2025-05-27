import { db } from '../src/database/postgres';
import { TokenAnalyzer } from '../src/analysis/token-analyzer';
import { apiManager } from '../src/integrations/api-manager';

async function carefulAnalysis() {
  console.log('\n🎯 Careful Token Analysis (Respecting Rate Limits)\n');

  // Check API status first
  const apiStatus = apiManager.getStatus();
  console.log('📊 API Status:');
  for (const api of apiStatus) {
    if (api.name !== 'cache') {
      const emoji = api.rateLimitRemaining > 0 ? '✅' : '⚠️';
      console.log(`  ${emoji} ${api.name}: ${api.requestsInWindow} requests, ${api.rateLimitRemaining} remaining`);
    }
  }

  // If Birdeye is over limit, wait
  const birdeyeStatus = apiStatus.find(api => api.name === 'birdeye');
  if (birdeyeStatus && birdeyeStatus.rateLimitRemaining < 0) {
    console.log('\n⏳ Birdeye is over rate limit. Waiting 60 seconds...');
    await new Promise(resolve => setTimeout(resolve, 60000));
  }

  // Get a small batch of pending tokens
  const pendingTokens = await db('tokens')
    .select('address', 'symbol', 'name', 'created_at')
    .where('analysis_status', 'PENDING')
    .where('created_at', '<', new Date(Date.now() - 600000)) // At least 10 minutes old
    .orderBy('created_at', 'asc') // Oldest first (more likely to be on DEX)
    .limit(5); // Only 5 at a time

  console.log(`\n📋 Found ${pendingTokens.length} tokens to analyze\n`);

  const analyzer = new TokenAnalyzer();
  let successCount = 0;

  for (const token of pendingTokens) {
    const tokenAge = Date.now() - new Date(token.created_at).getTime();
    const ageMinutes = Math.floor(tokenAge / 60000);

    console.log(`\n🔍 Analyzing ${token.symbol || token.address.slice(0, 8)} (${ageMinutes} minutes old)...`);
    
    try {
      // Mark as analyzing to prevent duplicate processing
      await db('tokens')
        .where('address', token.address)
        .update({ analysis_status: 'ANALYZING' });

      const result = await analyzer.analyzeToken(token.address);
      
      if (result.price > 0) {
        successCount++;
        console.log(`  ✅ Success! Price: $${result.price.toFixed(8)}`);
        console.log(`  📊 Score: ${(result.compositeScore * 100).toFixed(1)}%`);
        console.log(`  📈 Classification: ${result.classification}`);
      } else {
        console.log(`  ⏳ No DEX data yet`);
      }

      // Wait between analyses to respect rate limits
      console.log('  ⏰ Waiting 5 seconds before next token...');
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      
      // Mark as failed
      await db('tokens')
        .where('address', token.address)
        .update({ 
          analysis_status: 'FAILED',
          updated_at: new Date()
        });
    }
  }

  // Final stats
  console.log('\n📊 Analysis Summary:');
  console.log(`  ✅ Successfully analyzed: ${successCount}`);
  console.log(`  ❌ Failed: ${pendingTokens.length - successCount}`);

  // Check remaining pending
  const remainingCount = await db('tokens')
    .where('analysis_status', 'PENDING')
    .count('* as count')
    .first();

  if (remainingCount && Number(remainingCount.count) > 0) {
    console.log(`\n📌 ${remainingCount.count} tokens still pending analysis`);
    console.log('   Run this script again after rate limits reset');
  }

  console.log('\n✅ Careful analysis complete!\n');
}

// Run the analysis
carefulAnalysis()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });