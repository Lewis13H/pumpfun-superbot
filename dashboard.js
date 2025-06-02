const { db } = require('./src/database/postgres');

async function dashboard() {
  console.clear();
  console.log('Token Monitoring Dashboard - Updates every 10s');
  console.log('='.repeat(60));
  
  while (true) {
    const stats = await db('tokens')
      .select('monitoring_priority')
      .count('* as count')
      .groupBy('monitoring_priority');
    
    const last5min = await db('tokens')
      .where('updated_at', '>', new Date(Date.now() - 5 * 60 * 1000))
      .count('* as count')
      .first();
    
    const highPriorityTokens = await db('tokens')
      .join('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
      .where('tokens.monitoring_priority', 'high')
      .orderBy('enhanced_token_metrics.market_cap', 'desc')
      .limit(5)
      .select('tokens.symbol', 'enhanced_token_metrics.market_cap', 'enhanced_token_metrics.graduation_distance', 'tokens.updated_at');
    
    console.log('\nPriority Distribution:');
    stats.forEach(s => {
      const priority = s.monitoring_priority || 'normal';
      console.log(`  ${priority}: ${s.count} tokens`);
    });
    
    console.log(`\nTokens updated in last 5 min: ${last5min.count}`);
    console.log(`Update rate: ${(last5min.count / 5).toFixed(1)} tokens/min`);
    
    if (highPriorityTokens.length > 0) {
      console.log('\nHigh Priority Tokens:');
      highPriorityTokens.forEach(t => {
        const mc = (t.market_cap / 1000).toFixed(1);
        const grad = (t.graduation_distance * 100).toFixed(1);
        const lastUpdate = Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 1000);
        console.log(`  ${t.symbol}: $${mc}k (${grad}%), updated ${lastUpdate}s ago`);
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.clear();
    console.log('Token Monitoring Dashboard - Updates every 10s');
    console.log('='.repeat(60));
  }
}

dashboard().catch(console.error);
