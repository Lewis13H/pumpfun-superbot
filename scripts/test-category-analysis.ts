import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { db } from '../src/database/postgres';

async function testAnalysis() {
  // Get tokens from different categories
  const testTokens = await db('tokens')
    .select('address', 'symbol', 'category')
    .whereIn('category', ['LOW', 'MEDIUM', 'HIGH', 'AIM'])
    .limit(2)
    .groupBy('category');
  
  console.log('Testing category-based analysis...\n');
  
  for (const token of testTokens) {
    console.log(`\nAnalyzing ${token.symbol} (${token.category})...`);
    
    try {
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        token.category,
        false
      );
      
      console.log('Result:');
      console.log(`  Market Cap: $${result.marketCap}`);
      console.log(`  APIs Used: ${result.apisUsed.join(', ')}`);
      console.log(`  Cost: $${result.costIncurred.toFixed(3)}`);
      console.log(`  Analysis Type: ${result.analysisType}`);
      
      if (result.solsnifferScore !== undefined) {
        console.log(`  SolSniffer Score: ${result.solsnifferScore}`);
      }
    } catch (error) {
      console.error(`  Error: ${error}`);
    }
  }
  
  // Test AIM token with full analysis
  console.log('\n\nTesting AIM token with full analysis...');
  const aimToken = await db('tokens')
    .where('category', 'AIM')
    .first();
  
  if (aimToken) {
    const result = await categoryAPIRouter.analyzeToken(
      aimToken.address,
      'AIM',
      true
    );
    
    console.log(`\nFull Analysis of ${aimToken.symbol}:`);
    console.log(`  Market Cap: $${result.marketCap}`);
    console.log(`  Liquidity: $${result.liquidity}`);
    console.log(`  SolSniffer Score: ${result.solsnifferScore || 'N/A'}`);
    console.log(`  Top 10%: ${result.top10Percent || 'N/A'}%`);
    console.log(`  APIs Used: ${result.apisUsed.join(', ')}`);
    console.log(`  Total Cost: $${result.costIncurred.toFixed(3)}`);
  }
}

testAnalysis()
  .then(() => process.exit(0))
  .catch(console.error);
