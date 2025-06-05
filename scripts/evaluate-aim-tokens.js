const { categoryAPIRouter } = require('../dist/analysis/category-api-router');
const { BuySignalEvaluator } = require('../dist/trading/buy-signal-evaluator');
const { db } = require('../dist/database/postgres');

async function evaluateAimTokens() {
  console.log('🎯 Evaluating AIM tokens...\n');
  
  // Create evaluator instance
  const buySignalEvaluator = new BuySignalEvaluator();
  
  // Get all AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('address', 'symbol', 'market_cap', 'liquidity', 'holders');
  
  console.log(`Found ${aimTokens.length} AIM tokens to evaluate:\n`);
  
  for (const token of aimTokens) {
    console.log(`\n📊 Evaluating ${token.symbol} (${token.address})`);
    console.log(`   Market Cap: $${token.market_cap.toLocaleString()}`);
    console.log(`   Liquidity: $${token.liquidity.toLocaleString()}`);
    console.log(`   Holders: ${token.holders}`);
    
    try {
      // Force full analysis (including SolSniffer)
      console.log('   🔍 Running full analysis...');
      const analysis = await categoryAPIRouter.analyzeToken(
        token.address, 
        'AIM', 
        true // Force full analysis
      );
      
      console.log(`   ✅ Analysis complete:`);
      console.log(`      Top 10%: ${analysis.top10Percent || 'N/A'}%`);
      console.log(`      SolSniffer: ${analysis.solsnifferScore || 'N/A'}`);
      
      // Evaluate for buy signal
      console.log('   🎯 Checking buy signal...');
      const signal = await buySignalEvaluator.evaluateToken(token.address);
      
      if (signal) {
        console.log(`   🚀 BUY SIGNAL GENERATED!`);
      } else {
        console.log(`   ❌ No buy signal`);
      }
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
    
    // Small delay between tokens
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  process.exit(0);
}

evaluateAimTokens().catch(console.error);
