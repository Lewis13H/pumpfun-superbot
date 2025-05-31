import { db } from '../src/database/postgres';

async function monitorNewTokens() {
  console.log('Monitoring new token discoveries...\n');
  
  let lastCheck = new Date();
  
  const checkNewTokens = async () => {
    try {
      // Get tokens discovered since last check
      const newTokens = await db('tokens')
        .where('created_at', '>', lastCheck)
        .orderBy('created_at', 'desc');
      
      if (newTokens.length > 0) {
        console.log(`\n[${new Date().toLocaleTimeString()}] Found ${newTokens.length} new tokens:`);
        
        newTokens.forEach(token => {
          console.log(`\n${token.symbol} (${token.address.substring(0,8)}...)`);
          console.log(`  Platform: ${token.platform}`);
          console.log(`  Market Cap: $${token.market_cap || 0}`);
          console.log(`  Creator: ${token.creator ? '✓' : '✗'}`);
          console.log(`  Bonding Curve: ${token.bonding_curve ? '✓' : '✗'}`);
          console.log(`  Analysis Status: ${token.analysis_status}`);
        });
        
        lastCheck = new Date();
      } else {
        process.stdout.write('.');
      }
    } catch (error) {
      console.error('\nError:', error);
    }
  };
  
  // Initial check
  await checkNewTokens();
  
  // Check every 5 seconds
  setInterval(checkNewTokens, 5000);
  
  console.log('Monitoring... (dots indicate no new tokens)\n');
}

monitorNewTokens();
