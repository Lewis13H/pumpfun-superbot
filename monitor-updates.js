const { db } = require('./src/database/postgres');

async function monitorUpdates() {
  console.log('Monitoring token updates in real-time...');
  console.log('Press Ctrl+C to stop\n');
  
  let lastCheck = new Date();
  
  setInterval(async () => {
    const updates = await db('tokens')
      .where('updated_at', '>', lastCheck)
      .select('symbol', 'monitoring_priority', 'updated_at', 'market_cap');
    
    if (updates.length > 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] ${updates.length} tokens updated:`);
      updates.forEach(t => {
        const priority = t.monitoring_priority || 'normal';
        const mc = t.market_cap ? `$${(t.market_cap/1000).toFixed(1)}k` : 'N/A';
        console.log(`  - ${t.symbol} (${priority}): ${mc}`);
      });
    }
    
    lastCheck = new Date();
  }, 5000); // Check every 5 seconds
}

monitorUpdates().catch(console.error);
