// scripts/real-time-dashboard.ts - Real-time monitoring dashboard
import { db } from '../src/database/postgres';
import { clearInterval } from 'timers';

interface TokenStats {
  address: string;
  symbol: string;
  bonding_curve: string | null;
  market_cap: number;
  current_price_usd: number;
  price_change_1h: number | null;
  last_price_update: Date | null;
  price_update_count: number;
  curve_progress: number;
}

async function realTimeDashboard() {
  console.clear();
  console.log('=== Pump.fun Real-Time Dashboard ===\n');
  console.log('Starting monitoring... (Press Ctrl+C to exit)\n');
  
  let iteration = 0;
  
  const updateDashboard = async () => {
    iteration++;
    console.clear();
    console.log(`=== Pump.fun Real-Time Dashboard === [Update #${iteration}]`);
    console.log(`Time: ${new Date().toLocaleString()}\n`);
    
    try {
      // 1. Overall Statistics
      const stats = await db('tokens')
        .select(
          db.raw('COUNT(*) as total_tokens'),
          db.raw('COUNT(CASE WHEN bonding_curve IS NOT NULL THEN 1 END) as tokens_with_bc'),
          db.raw('COUNT(CASE WHEN last_price_update IS NOT NULL THEN 1 END) as tokens_with_prices'),
          db.raw('COUNT(CASE WHEN last_price_update > NOW() - INTERVAL \'5 minutes\' THEN 1 END) as active_tokens')
        )
        .first();
      
      console.log('📊 OVERALL STATISTICS');
      console.log(`Total Tokens: ${stats.total_tokens}`);
      console.log(`With Bonding Curves: ${stats.tokens_with_bc} (${(stats.tokens_with_bc / stats.total_tokens * 100).toFixed(1)}%)`);
      console.log(`With Price Data: ${stats.tokens_with_prices} (${(stats.tokens_with_prices / stats.total_tokens * 100).toFixed(1)}%)`);
      console.log(`Active (last 5 min): ${stats.active_tokens}`);
      
      // 2. Price Update Activity
      const priceActivity = await db('timeseries.token_prices')
        .select(
          db.raw('COUNT(*) as updates_1min'),
          db.raw('COUNT(DISTINCT token_address) as unique_tokens_1min')
        )
        .where('time', '>', db.raw('NOW() - INTERVAL \'1 minute\''))
        .first();
      
      console.log('\n💰 PRICE UPDATE ACTIVITY');
      console.log(`Updates in last minute: ${priceActivity.updates_1min}`);
      console.log(`Unique tokens updated: ${priceActivity.unique_tokens_1min}`);
      console.log(`Update rate: ${(priceActivity.updates_1min / 60).toFixed(1)} updates/sec`);
      
      // 3. Top Active Tokens
      const activeTokens = await db('tokens')
        .whereNotNull('last_price_update')
        .where('last_price_update', '>', db.raw('NOW() - INTERVAL \'5 minutes\''))
        .orderBy('price_update_count', 'desc')
        .limit(5)
        .select<TokenStats[]>(
          'address',
          'symbol',
          'bonding_curve',
          'market_cap',
          'current_price_usd',
          'price_change_1h',
          'last_price_update',
          'price_update_count',
          'curve_progress'
        );
      
      console.log('\n🔥 TOP ACTIVE TOKENS');
      if (activeTokens.length > 0) {
        console.log('Symbol    | Market Cap    | Price USD      | 1h Change | Updates | Progress');
        console.log('----------|---------------|----------------|-----------|---------|----------');
        
        activeTokens.forEach(token => {
          const symbol = (token.symbol || 'UNKNOWN').padEnd(9).substring(0, 9);
          const marketCap = `$${(token.market_cap || 0).toLocaleString()}`.padEnd(13);
          const price = `$${(token.current_price_usd || 0).toFixed(6)}`.padEnd(14);
          const change = token.price_change_1h 
            ? `${token.price_change_1h > 0 ? '+' : ''}${token.price_change_1h.toFixed(1)}%`.padEnd(9)
            : 'N/A'.padEnd(9);
          const updates = token.price_update_count.toString().padEnd(7);
          const progress = `${(token.curve_progress || 0).toFixed(1)}%`;
          
          console.log(`${symbol} | ${marketCap} | ${price} | ${change} | ${updates} | ${progress}`);
        });
      } else {
        console.log('No active tokens found');
      }
      
      // 4. Recent Token Creations
      const recentTokens = await db('tokens')
        .where('created_at', '>', db.raw('NOW() - INTERVAL \'10 minutes\''))
        .orderBy('created_at', 'desc')
        .limit(3)
        .select('address', 'symbol', 'bonding_curve', 'created_at');
      
      console.log('\n🆕 RECENT TOKEN CREATIONS (last 10 min)');
      if (recentTokens.length > 0) {
        recentTokens.forEach(token => {
          const age = Math.floor((Date.now() - new Date(token.created_at).getTime()) / 1000);
          const ageStr = age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`;
          console.log(`- ${token.symbol || 'UNKNOWN'} (${token.address.substring(0, 10)}...) - ${ageStr}`);
          console.log(`  BC: ${token.bonding_curve ? '✅ ' + token.bonding_curve.substring(0, 20) + '...' : '❌ Missing'}`);
        });
      } else {
        console.log('No recent token creations');
      }
      
      // 5. System Health
      const dbSize = await db.raw(`
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) as db_size,
          (SELECT pg_size_pretty(sum(total_bytes)) FROM timescaledb_information.hypertables) as timeseries_size
      `);
      
      console.log('\n🏥 SYSTEM HEALTH');
      console.log(`Database Size: ${dbSize.rows[0].db_size}`);
      console.log(`TimeSeries Data: ${dbSize.rows[0].timeseries_size || 'N/A'}`);
      
      // Check for issues
      const issues = [];
      if (stats.active_tokens === 0) issues.push('❌ No active price updates');
      if (stats.tokens_with_bc === 0) issues.push('❌ No tokens with bonding curves');
      if (priceActivity.updates_1min === 0) issues.push('❌ No price updates in last minute');
      
      if (issues.length > 0) {
        console.log('\n⚠️  ISSUES DETECTED:');
        issues.forEach(issue => console.log(issue));
      } else {
        console.log('\n✅ All systems operational');
      }
      
    } catch (error) {
      console.error('\n❌ Dashboard Error:', error);
    }
  };
  
  // Initial update
  await updateDashboard();
  
  // Update every 5 seconds
  const interval = setInterval(updateDashboard, 5000);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down dashboard...');
    clearInterval(interval);
    await db.destroy();
    process.exit(0);
  });
}

// Run dashboard
realTimeDashboard().catch(error => {
  console.error('Dashboard error:', error);
  process.exit(1);
});