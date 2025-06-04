// scripts/token-lifecycle-monitor.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function monitorLifecycle() {
  console.log('🔄 Token Lifecycle Monitor\n');
  
  while (true) {
    try {
      console.clear();
      console.log(`🔄 TOKEN LIFECYCLE - ${new Date().toLocaleTimeString()}\n`);
      
      // 1. NEW tokens status
      const newTokens = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN market_cap >= 8000 THEN 1 END) as ready_for_medium,
          COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 minutes' THEN 1 END) as should_timeout,
          MIN(created_at) as oldest,
          MAX(created_at) as newest
        FROM tokens
        WHERE category = 'NEW'
      `);
      
      console.log('📌 NEW Tokens:');
      console.log(`   Total: ${newTokens.rows[0].total}`);
      console.log(`   Ready for MEDIUM (>$8k): ${newTokens.rows[0].ready_for_medium}`);
      console.log(`   Should timeout to LOW: ${newTokens.rows[0].should_timeout}`);
      console.log(`   Age range: ${getAgeString(newTokens.rows[0].oldest)} to ${getAgeString(newTokens.rows[0].newest)}\n`);
      
      // 2. Recent transitions
      const transitions = await pool.query(`
        SELECT 
          from_category,
          to_category,
          COUNT(*) as count,
          AVG(market_cap_at_transition) as avg_mc
        FROM category_transitions
        WHERE created_at > NOW() - INTERVAL '10 minutes'
        GROUP BY from_category, to_category
        ORDER BY count DESC
        LIMIT 10
      `);
      
      if (transitions.rows.length > 0) {
        console.log('🔀 Recent Transitions (10 min):');
        transitions.rows.forEach(t => {
          console.log(`   ${t.from_category} → ${t.to_category}: ${t.count} tokens (avg $${parseFloat(t.avg_mc).toFixed(0)})`);
        });
        console.log('');
      }
      
      // 3. Token flow visualization
      const flow = await pool.query(`
        WITH token_ages AS (
          SELECT 
            category,
            CASE 
              WHEN created_at > NOW() - INTERVAL '5 minutes' THEN '0-5 min'
              WHEN created_at > NOW() - INTERVAL '15 minutes' THEN '5-15 min'
              WHEN created_at > NOW() - INTERVAL '30 minutes' THEN '15-30 min'
              WHEN created_at > NOW() - INTERVAL '1 hour' THEN '30-60 min'
              WHEN created_at > NOW() - INTERVAL '3 hours' THEN '1-3 hours'
              ELSE '3+ hours'
            END as age_bucket,
            COUNT(*) as count
          FROM tokens
          WHERE category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
          GROUP BY category, age_bucket
        )
        SELECT * FROM token_ages
        ORDER BY 
          CASE category
            WHEN 'NEW' THEN 1
            WHEN 'LOW' THEN 2
            WHEN 'MEDIUM' THEN 3
            WHEN 'HIGH' THEN 4
            WHEN 'AIM' THEN 5
          END,
          CASE age_bucket
            WHEN '0-5 min' THEN 1
            WHEN '5-15 min' THEN 2
            WHEN '15-30 min' THEN 3
            WHEN '30-60 min' THEN 4
            WHEN '1-3 hours' THEN 5
            ELSE 6
          END
      `);
      
      console.log('📊 Token Age Distribution:');
      let currentCategory = '';
      flow.rows.forEach(row => {
        if (row.category !== currentCategory) {
          console.log(`\n   ${row.category}:`);
          currentCategory = row.category;
        }
        console.log(`     ${row.age_bucket}: ${row.count} tokens`);
      });
      
      // 4. Rising stars
      const rising = await pool.query(`
        SELECT 
          t.symbol,
          t.category,
          t.market_cap,
          t.created_at,
          COUNT(ct.id) as transitions
        FROM tokens t
        LEFT JOIN category_transitions ct ON ct.token_address = t.address
        WHERE t.created_at > NOW() - INTERVAL '1 hour'
          AND t.market_cap > 10000
        GROUP BY t.address, t.symbol, t.category, t.market_cap, t.created_at
        ORDER BY t.market_cap DESC
        LIMIT 5
      `);
      
      if (rising.rows.length > 0) {
        console.log('\n⭐ Rising Stars (last hour):');
        rising.rows.forEach(t => {
          const age = getAgeString(t.created_at);
          console.log(`   ${t.symbol}: $${parseFloat(t.market_cap).toFixed(0)} - ${t.category} (${age} old, ${t.transitions} moves)`);
        });
      }
      
      // 5. Scan activity
      const scanActivity = await pool.query(`
        SELECT 
          category,
          COUNT(DISTINCT token_address) as tokens_scanned,
          COUNT(*) as total_scans
        FROM scan_logs
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        GROUP BY category
      `);
      
      if (scanActivity.rows.length > 0) {
        console.log('\n📡 Scan Activity (5 min):');
        scanActivity.rows.forEach(s => {
          console.log(`   ${s.category}: ${s.tokens_scanned} tokens, ${s.total_scans} scans`);
        });
      }
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

function getAgeString(date) {
  if (!date) return 'never';
  const age = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(age / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

monitorLifecycle().catch(console.error);