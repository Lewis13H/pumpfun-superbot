const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function forceUpdateAllCategories() {
  console.log('Force updating ALL token categories...\n');
  
  try {
    // This will trigger the auto-update for ALL tokens
    const result = await pool.query(`
      UPDATE tokens 
      SET market_cap = market_cap + 0.01
      WHERE category NOT IN ('BIN', 'COMPLETE')
        AND market_cap IS NOT NULL
        AND market_cap > 0
      RETURNING symbol, category, market_cap
    `);
    
    console.log(`✓ Updated ${result.rowCount} tokens\n`);
    
    // Show new distribution
    const dist = await pool.query(`
      SELECT category, COUNT(*) as count, 
             MIN(market_cap) as min_mc, 
             MAX(market_cap) as max_mc
      FROM tokens 
      WHERE category != 'BIN'
      GROUP BY category 
      ORDER BY 
        CASE category
          WHEN 'AIM' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'NEW' THEN 4
          WHEN 'LOW' THEN 5
          ELSE 6
        END
    `);
    
    console.log('New distribution:');
    console.table(dist.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

forceUpdateAllCategories().catch(console.error);