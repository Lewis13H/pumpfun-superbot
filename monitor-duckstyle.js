const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function monitorToken() {
  const tokenAddress = '7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump';
  
  setInterval(async () => {
    try {
      const result = await pool.query(`
        SELECT 
          symbol,
          category,
          market_cap,
          liquidity,
          holders,
          EXTRACT(EPOCH FROM (NOW() - updated_at)) as seconds_since_update
        FROM tokens 
        WHERE address = $1
      `, [tokenAddress]);
      
      if (result.rows.length > 0) {
        const token = result.rows[0];
        console.log(`[${new Date().toISOString()}] DuckStyle - Category: ${token.category}, MC: $${token.market_cap}, Updated: ${Math.round(token.seconds_since_update)}s ago`);
      } else {
        console.log(`[${new Date().toISOString()}] TOKEN NOT FOUND!`);
      }
    } catch (error) {
      console.error('Monitor error:', error.message);
    }
  }, 10000); // Check every 10 seconds
}

console.log('Starting DuckStyle monitor...');
monitorToken();
