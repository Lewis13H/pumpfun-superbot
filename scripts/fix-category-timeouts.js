// scripts/fix-category-timeouts.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

// Category timeout durations (from your config)
const TIMEOUTS = {
  NEW: 30 * 60 * 1000,      // 30 minutes
  LOW: 3 * 60 * 60 * 1000,  // 3 hours
  MEDIUM: 60 * 60 * 1000,   // 1 hour
  HIGH: 60 * 60 * 1000,     // 1 hour
  AIM: 2 * 60 * 60 * 1000,  // 2 hours
};

async function processTimeouts() {
  console.log('⏰ Processing category timeouts...\n');
  
  try {
    // 1. Move timed-out NEW tokens to LOW (if still under $8k)
    const newToLow = await pool.query(`
      WITH timed_out AS (
        SELECT address, symbol, market_cap, category_scan_count
        FROM tokens
        WHERE category = 'NEW'
          AND created_at < NOW() - INTERVAL '30 minutes'
          AND market_cap < 8000
      )
      UPDATE tokens t
      SET 
        category = 'LOW',
        category_updated_at = NOW(),
        category_scan_count = 0
      FROM timed_out
      WHERE t.address = timed_out.address
      RETURNING t.symbol, t.market_cap
    `);
    
    if (newToLow.rowCount > 0) {
      console.log(`✅ Moved ${newToLow.rowCount} NEW tokens to LOW (timed out)`);
      newToLow.rows.slice(0, 5).forEach(t => 
        console.log(`   ${t.symbol}: $${t.market_cap}`)
      );
    }
    
    // 2. Archive tokens that have been in LOW too long
    const lowToArchive = await pool.query(`
      UPDATE tokens
      SET 
        category = 'ARCHIVE',
        category_updated_at = NOW()
      WHERE category = 'LOW'
        AND created_at < NOW() - INTERVAL '3 hours'
        AND last_scan_at < NOW() - INTERVAL '1 hour'
      RETURNING symbol, market_cap
    `);
    
    if (lowToArchive.rowCount > 0) {
      console.log(`\n📦 Archived ${lowToArchive.rowCount} stale LOW tokens`);
    }
    
    // 3. Show current state
    const summary = await pool.query(`
      SELECT 
        category,
        COUNT(*) as total,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 minutes' THEN 1 END) as recent,
        COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 minutes' AND category = 'NEW' THEN 1 END) as should_timeout,
        AVG(EXTRACT(EPOCH FROM (NOW() - created_at))/60)::int as avg_age_minutes
      FROM tokens
      WHERE category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
      GROUP BY category
      ORDER BY 
        CASE category
          WHEN 'AIM' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'NEW' THEN 4
          WHEN 'LOW' THEN 5
        END
    `);
    
    console.log('\n📊 Category Summary:');
    console.table(summary.rows);
    
    // Log transitions
    for (const token of newToLow.rows) {
      await pool.query(
        `INSERT INTO category_transitions 
         (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
         SELECT address, 'NEW', 'LOW', $2, 'Timeout - no growth after 30 minutes', NOW()
         FROM tokens WHERE symbol = $1`,
        [token.symbol, token.market_cap]
      );
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run continuously
async function runContinuously() {
  while (true) {
    await processTimeouts();
    console.log('\n⏳ Next check in 60 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}

// Run once or continuously
if (process.argv[2] === '--continuous') {
  console.log('Running in continuous mode...\n');
  runContinuously().catch(console.error);
} else {
  processTimeouts().then(() => pool.end());
}