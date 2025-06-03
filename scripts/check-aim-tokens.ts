import { db } from '../src/database/postgres';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';

async function checkAimTokens() {
  console.log('=== Checking AIM Tokens ===\n');
  
  // Get all tokens that recently entered AIM range
  const potentialAim = await db('tokens')
    .whereBetween('market_cap', [35000, 105000])
    .orderBy('market_cap', 'desc')
    .limit(10)
    .select('address', 'symbol', 'category', 'market_cap', 'liquidity', 'holders');
  
  console.log(`Found ${potentialAim.length} tokens in AIM market cap range:\n`);
  
  for (const token of potentialAim) {
    console.log(`${token.symbol}:`);
    console.log(`  Category: ${token.category}`);
    console.log(`  Market Cap: $${token.market_cap}`);
    console.log(`  Liquidity: $${token.liquidity || 0}`);
    console.log(`  Holders: ${token.holders || 0}`);
    
    // Check what data is missing
    const missing = [];
    if (!token.liquidity || token.liquidity < 7500) missing.push('liquidity');
    if (!token.holders || token.holders < 50) missing.push('holders');
    
    const solsnifferData = await db('tokens')
      .where('address', token.address)
      .select('solsniffer_score', 'solsniffer_checked_at', 'top_10_percent')
      .first();
    
    if (!solsnifferData?.solsniffer_score) missing.push('SolSniffer');
    if (!solsnifferData?.top_10_percent) missing.push('concentration');
    
    if (missing.length > 0) {
      console.log(`  ⚠️  Missing/Low: ${missing.join(', ')}`);
    }
    console.log('');
  }
  
  await db.destroy();
}

checkAimTokens();