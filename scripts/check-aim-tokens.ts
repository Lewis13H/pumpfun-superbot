import { db } from '../src/database/postgres';

async function checkAimTokens() {
  console.log('=== Checking AIM Tokens ===\n');
  
  // 1. Get all AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('address', 'symbol', 'market_cap', 'liquidity', 'holders', 'solsniffer_score', 
            'updated_at', 'category_updated_at', 'aim_attempts', 'buy_attempts');
  
  console.log(`Found ${aimTokens.length} tokens in AIM category:\n`);
  
  aimTokens.forEach(token => {
    console.log(`Token: ${token.symbol} (${token.address.slice(0, 8)}...)`);
    console.log(`  Market Cap: $${token.market_cap}`);
    console.log(`  Liquidity: $${token.liquidity}`);
    console.log(`  Holders: ${token.holders}`);
    console.log(`  SolSniffer Score: ${token.solsniffer_score || 'N/A'}`);
    console.log(`  Last Updated: ${token.updated_at}`);
    console.log(`  Category Updated: ${token.category_updated_at}`);
    console.log(`  AIM Attempts: ${token.aim_attempts}`);
    console.log(`  Buy Attempts: ${token.buy_attempts}`);
    console.log('');
  });
  
  // 2. Check recent transitions to AIM
  console.log('\n=== Recent Transitions to AIM ===\n');
  
  const recentTransitions = await db('category_transitions')
    .where('to_category', 'AIM')
    .orderBy('created_at', 'desc')
    .limit(10)
    .select('token_address', 'from_category', 'market_cap_at_transition', 'created_at');
  
  for (const transition of recentTransitions) {
    const token = await db('tokens')
      .where('address', transition.token_address)
      .first();
    
    console.log(`${token?.symbol || transition.token_address.slice(0, 8)}: ${transition.from_category} → AIM`);
    console.log(`  Market Cap at transition: $${transition.market_cap_at_transition}`);
    console.log(`  Transition time: ${transition.created_at}`);
    console.log(`  Current Market Cap: $${token?.market_cap}`);
    console.log('');
  }
  
  // 3. Check if these tokens have been scanned
  console.log('\n=== Recent Scans of AIM Tokens ===\n');
  
  for (const token of aimTokens.slice(0, 3)) {
    const recentScans = await db('scan_logs')
      .where('token_address', token.address)
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('category', 'scan_number', 'scan_duration_ms', 'apis_called', 'created_at');
    
    console.log(`Scans for ${token.symbol}:`);
    if (recentScans.length === 0) {
      console.log('  No recent scans found!');
    } else {
      recentScans.forEach(scan => {
        console.log(`  ${scan.created_at}: Category ${scan.category}, APIs: ${scan.apis_called}`);
      });
    }
    console.log('');
  }
}

checkAimTokens()
  .then(() => process.exit(0))
  .catch(console.error);