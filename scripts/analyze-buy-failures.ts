import { db } from '../src/database/postgres';

async function analyzeBuyFailures() {
  console.log('=== Analyzing Buy Signal Failures ===\n');
  
  // Get recent failed evaluations with details
  const failures = await db('buy_evaluations')
    .where('passed', false)
    .orderBy('created_at', 'desc')
    .limit(20);
  
  // Analyze failure reasons
  const reasonCounts: Record<string, number> = {};
  
  for (const failure of failures) {
    // Handle both JSON and plain text formats
    let reasons: string[] = [];
    try {
      reasons = JSON.parse(failure.failure_reasons || '[]');
    } catch (e) {
      // If not JSON, treat as single reason
      if (failure.failure_reasons) {
        reasons = [failure.failure_reasons];
      }
    }
    
    reasons.forEach((reason: string) => {
      const category = reason.includes('Market cap') ? 'Market Cap' :
                      reason.includes('Liquidity') ? 'Liquidity' :
                      reason.includes('Holders') ? 'Holders' :
                      reason.includes('concentration') ? 'Concentration' :
                      reason.includes('SolSniffer') ? 'SolSniffer' : 'Other';
      
      reasonCounts[category] = (reasonCounts[category] || 0) + 1;
    });
  }
  
  console.log('Failure Reason Categories:');
  Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count} failures`);
    });
  
  // Show detailed failures for recent tokens
  console.log('\nRecent Token Details:');
  
  const recentTokens = await db('buy_evaluations as be')
    .join('tokens as t', 'be.token_address', 't.address')
    .where('be.passed', false)
    .orderBy('be.created_at', 'desc')
    .limit(5)
    .select(
      't.symbol',
      'be.market_cap',
      'be.liquidity',
      'be.holders',
      'be.top_10_percent',
      'be.solsniffer_score',
      'be.failure_reasons'
    );
  
  for (const token of recentTokens) {
    console.log(`\n${token.symbol}:`);
    console.log(`  Market Cap: $${Number(token.market_cap).toFixed(2)}`);
    console.log(`  Liquidity: $${Number(token.liquidity).toFixed(2)}`);
    console.log(`  Holders: ${token.holders || 'N/A'}`);
    console.log(`  Top 10%: ${token.top_10_percent ? Number(token.top_10_percent).toFixed(2) : 'N/A'}%`);
    console.log(`  SolSniffer: ${token.solsniffer_score || 'N/A'}`);
    
    // Handle failure reasons
    let failureReasons: string[] = [];
    try {
      failureReasons = JSON.parse(token.failure_reasons);
    } catch (e) {
      if (token.failure_reasons) {
        failureReasons = [token.failure_reasons];
      }
    }
    console.log(`  Failures: ${failureReasons.join(', ')}`);
  }
  
  await db.destroy();
}

analyzeBuyFailures();