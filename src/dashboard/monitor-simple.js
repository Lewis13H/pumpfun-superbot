// monitor-simple.js - Zero dependency monitor
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'memecoin_discovery',
  user: 'memecoin_user',
  password: process.env.POSTGRES_PASSWORD || 'Bhaal1313!!'
});

async function monitor() {
  setInterval(async () => {
    try {
      console.clear();
      
      // Get stats
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN last_price_update > NOW() - INTERVAL '5 minutes' THEN 1 END) as active,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as new_1h
        FROM tokens
      `);
      
      const prices = await pool.query(`
        SELECT COUNT(*) as count 
        FROM timeseries.token_prices 
        WHERE time > NOW() - INTERVAL '1 minute'
      `);
      
      const topMovers = await pool.query(`
        SELECT symbol, price_change_1h, market_cap 
        FROM tokens 
        WHERE price_change_1h IS NOT NULL 
        ORDER BY price_change_1h DESC 
        LIMIT 5
      `);
      
      console.log('='.repeat(50));
      console.log('MEMECOIN BOT MONITOR');
      console.log('='.repeat(50));
      console.log(`Total Tokens: ${stats.rows[0].total}`);
      console.log(`Active (5m): ${stats.rows[0].active}`);
      console.log(`New (1h): ${stats.rows[0].new_1h}`);
      console.log(`Updates/min: ${prices.rows[0].count}`);
      console.log('');
      console.log('TOP MOVERS:');
      for (const mover of topMovers.rows) {
        const symbol = (mover.symbol || 'UNKNOWN').padEnd(10);
        const change = mover.price_change_1h ? `+${mover.price_change_1h.toFixed(2)}%` : 'N/A';
        console.log(`  ${symbol} ${change}`);
      }
      
    } catch (err) {
      console.error('Error:', err.message);
    }
  }, 2000);
}

console.log('Starting monitor...');
monitor();