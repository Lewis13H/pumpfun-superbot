import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { db } from '../src/database/postgres';

async function recalculateTop10() {
  console.log('Recalculating Top 10 concentration for AIM tokens...\n');
  
  // Get all AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('address', 'symbol');
  
  console.log(`Found ${aimTokens.length} AIM tokens to recalculate\n`);
  
  for (const token of aimTokens) {
    console.log(`Recalculating ${token.symbol}...`);
    
    try {
      // Force full analysis to recalculate top 10
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        'AIM',
        true // Force full analysis
      );
      
      console.log(`✓ ${token.symbol}: Top 10 = ${result.top10Percent}%`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error(`✗ ${token.symbol} failed:`, error.message);
    }
  }
  
  // Show updated results
  const updated = await db('tokens')
    .where('category', 'AIM')
    .select('symbol', 'top_10_percent', 'liquidity', 'holders', 'solsniffer_score');
  
  console.log('\n\nUpdated AIM tokens:');
  for (const token of updated) {
    console.log(`${token.symbol}:`);
    console.log(`  Top 10: ${token.top_10_percent}%`);
    console.log(`  Liquidity: $${parseFloat(token.liquidity).toFixed(2)}`);
    console.log(`  Holders: ${token.holders}`);
    console.log(`  SolSniffer: ${token.solsniffer_score || 'Not checked'}`);
  }
  
  process.exit(0);
}

recalculateTop10().catch(console.error);
