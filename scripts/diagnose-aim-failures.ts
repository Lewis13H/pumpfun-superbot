import { db } from '../src/database/postgres';

async function diagnoseAimFailures() {
  console.log('=== Diagnosing AIM Token Failures ===\n');
  
  // Get tokens that were evaluated in last 24h
  const evaluatedTokens = await db('buy_evaluations as be')
    .join('tokens as t', 'be.token_address', 't.address')
    .where('be.created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .select(
      't.symbol',
      't.address',
      'be.*'
    )
    .orderBy('be.created_at', 'desc')
    .limit(10);
  
  console.log(`Found ${evaluatedTokens.length} recent evaluations\n`);
  
  for (const token of evaluatedTokens) {
    console.log(`${token.symbol}:`);
    console.log(`  Market Cap: $${Number(token.market_cap).toFixed(2)} ${token.market_cap_pass ? '✅' : '❌'}`);
    console.log(`  Liquidity: $${Number(token.liquidity).toFixed(2)} ${token.liquidity_pass ? '✅' : '❌'}`);
    console.log(`  Holders: ${token.holders || 0} ${token.holders_pass ? '✅' : '❌'}`);
    console.log(`  Top 10%: ${token.top_10_percent ? Number(token.top_10_percent).toFixed(2) : 'N/A'}% ${token.concentration_pass ? '✅' : '❌'}`);
    console.log(`  SolSniffer: ${token.solsniffer_score || 0} ${token.solsniffer_pass ? '✅' : '❌'}`);
    console.log('');
  }
  
  // Summary of common failures
  console.log('\nSummary of failures:');
  
  const failureCounts = await db('buy_evaluations')
    .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
    .where('passed', false)
    .select(
      db.raw('SUM(CASE WHEN NOT market_cap_pass THEN 1 ELSE 0 END) as market_cap_fails'),
      db.raw('SUM(CASE WHEN NOT liquidity_pass THEN 1 ELSE 0 END) as liquidity_fails'),
      db.raw('SUM(CASE WHEN NOT holders_pass THEN 1 ELSE 0 END) as holders_fails'),
      db.raw('SUM(CASE WHEN NOT concentration_pass THEN 1 ELSE 0 END) as concentration_fails'),
      db.raw('SUM(CASE WHEN NOT solsniffer_pass THEN 1 ELSE 0 END) as solsniffer_fails')
    )
    .first();
  
  console.log(`  Market Cap failures: ${failureCounts.market_cap_fails}`);
  console.log(`  Liquidity failures: ${failureCounts.liquidity_fails}`);
  console.log(`  Holders failures: ${failureCounts.holders_fails}`);
  console.log(`  Concentration failures: ${failureCounts.concentration_fails}`);
  console.log(`  SolSniffer failures: ${failureCounts.solsniffer_fails}`);
  
  await db.destroy();
}

diagnoseAimFailures();