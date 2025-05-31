import { db } from '../src/database/postgres';

async function monitorDiscovery() {
  console.log('Monitoring token discovery... (updates every 10 seconds)\n');
  
  let lastCount = 0;
  
  const checkTokens = async () => {
    try {
      const result = await db('tokens').count('* as count');
      const currentCount = parseInt(String(result[0].count));
      
      const newTokens = currentCount - lastCount;
      lastCount = currentCount;
      
      const timestamp = new Date().toLocaleTimeString();
      
      if (newTokens > 0) {
        console.log(`[${timestamp}] +${newTokens} new tokens discovered! Total: ${currentCount}`);
        
        // Show the most recent tokens
        const latest = await db('tokens')
          .orderBy('created_at', 'desc')
          .limit(3);
        
        latest.forEach(token => {
          console.log(`  - ${token.symbol} (${token.platform}) - $${token.market_cap || 0}`);
        });
      } else {
        console.log(`[${timestamp}] No new tokens. Total: ${currentCount}`);
      }
      
      // Show processing stats
      const processing = await db('tokens')
        .where('analysis_status', 'PROCESSING')
        .count('* as count');
      
      const analyzed = await db('tokens')
        .where('analysis_status', 'COMPLETED')
        .count('* as count');
        
      console.log(`  Processing: ${processing[0].count}, Analyzed: ${analyzed[0].count}`);
      
    } catch (error) {
      console.error('Error:', error);
    }
  };
  
  // Run immediately
  const initial = await db('tokens').count('* as count');
  lastCount = parseInt(String(initial[0].count));
  console.log(`Starting count: ${lastCount} tokens\n`);
  
  // Check every 10 seconds
  setInterval(checkTokens, 10000);
  
  // Keep process running
  process.on('SIGINT', async () => {
    console.log('\nStopping monitor...');
    await db.destroy();
    process.exit(0);
  });
}

monitorDiscovery();
