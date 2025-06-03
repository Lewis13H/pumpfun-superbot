import { db } from '../src/database/postgres';
import { categoryAPIRouter } from '../src/analysis/category-api-router';

async function debugAimDataFetch() {
  console.log('=== Debugging AIM Data Fetch ===\n');
  
  // Get a token in AIM range that's missing data
  const token = await db('tokens')
    .whereBetween('market_cap', [35000, 105000])
    .where(function() {
      this.where('liquidity', 0)
        .orWhereNull('liquidity')
        .orWhere('holders', 0)
        .orWhereNull('holders')
    })
    .first();
  
  if (!token) {
    console.log('No tokens with missing data found');
    return;
  }
  
  console.log(`Testing with ${token.symbol}:`);
  console.log(`  Current Market Cap: $${token.market_cap}`);
  console.log(`  Current Liquidity: $${token.liquidity || 0}`);
  console.log(`  Current Holders: ${token.holders || 0}`);
  console.log(`  Current Category: ${token.category}\n`);
  
  // Force to AIM category to trigger full analysis
  console.log('Setting category to AIM...');
  await db('tokens')
    .where('address', token.address)
    .update({ category: 'AIM' });
  
  // Run full analysis
  console.log('\nRunning full analysis...');
  try {
    const result = await categoryAPIRouter.analyzeToken(
      token.address,
      'AIM',
      true // Force full analysis
    );
    
    console.log('\nAnalysis Result:');
    console.log(`  Market Cap: $${result.marketCap}`);
    console.log(`  Liquidity: $${result.liquidity}`);
    console.log(`  Holders: ${result.holders || 'N/A'}`);
    console.log(`  SolSniffer: ${result.solsnifferScore || 'N/A'}`);
    console.log(`  APIs Used: ${result.apisUsed.join(', ')}`);
    console.log(`  Cost: $${result.costIncurred.toFixed(3)}`);
    
    // Check if data was saved
    const updated = await db('tokens')
      .where('address', token.address)
      .first();
    
    console.log('\nData in Database After Analysis:');
    console.log(`  Market Cap: $${updated.market_cap}`);
    console.log(`  Liquidity: $${updated.liquidity}`);
    console.log(`  Holders: ${updated.holders || 0}`);
    console.log(`  SolSniffer: ${updated.solsniffer_score || 0}`);
    
  } catch (error) {
    console.error('Analysis error:', error);
  }
  
  await db.destroy();
}

debugAimDataFetch();