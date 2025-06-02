import { db } from '../src/database/postgres';

async function checkRealDiscoveries() {
  // Get tokens discovered in last hour
  const recentTokens = await db('tokens')
    .where('discovered_at', '>', new Date(Date.now() - 3600000))
    .whereNot('address', 'like', 'TEST%')
    .orderBy('discovered_at', 'desc')
    .limit(20)
    .select('symbol', 'address', 'category', 'market_cap', 'current_price', 'platform');
  
  console.log('\n=== Tokens Discovered in Last Hour ===');
  console.log(`Total: ${recentTokens.length}`);
  
  if (recentTokens.length > 0) {
    console.log('\nRecent tokens:');
    recentTokens.forEach(token => {
      console.log(`${token.symbol} - ${token.category} - MC: $${token.market_cap || 0} - Platform: ${token.platform}`);
    });
    
    // Group by platform
    const byPlatform = recentTokens.reduce((acc, t) => {
      acc[t.platform] = (acc[t.platform] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\nBy Platform:', byPlatform);
  } else {
    console.log('\n❌ No real tokens discovered recently!');
    console.log('Possible issues:');
    console.log('- WebSocket connection to Pump.fun not working');
    console.log('- RPC connection issues');
    console.log('- Network/firewall blocking connections');
  }
  
  process.exit(0);
}

checkRealDiscoveries();
