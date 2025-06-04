// scripts/watch-new-tokens.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function watchNewTokens() {
  while (true) {
    try {
      console.clear();
      console.log(`🆕 NEW TOKEN MONITOR - ${new Date().toLocaleTimeString()}\n`);
      
      // Summary stats
      const stats = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN last_scan_at IS NOT NULL THEN 1 END) as scanned,
          COUNT(CASE WHEN last_scan_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as recent_scans,
          COUNT(CASE WHEN market_cap >= 8000 THEN 1 END) as ready_medium,
          COUNT(CASE WHEN market_cap >= 19000 THEN 1 END) as ready_high,
          COUNT(CASE WHEN market_cap >= 35000 THEN 1 END) as ready_aim,
          COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 minutes' THEN 1 END) as timeout_pending
        FROM tokens
        WHERE category = 'NEW'
      `);
      
      const s = stats.rows[0];
      console.log(`📊 Status: ${s.total} total | ${s.scanned} scanned | ${s.recent_scans} recent\n`);
      console.log(`🎯 Ready for promotion:`);
      console.log(`   MEDIUM (≥$8k): ${s.ready_medium}`);
      console.log(`   HIGH (≥$19k): ${s.ready_high}`);
      console.log(`   AIM (≥$35k): ${s.ready_aim}`);
      console.log(`   Timeout pending: ${s.timeout_pending}\n`);
      
      // Top NEW tokens by market cap
      const top = await pool.query(`
        SELECT 
          symbol,
          market_cap,
          created_at,
          last_scan_at,
          category_scan_count,
          AGE(NOW(), created_at) as age
        FROM tokens
        WHERE category = 'NEW'
        ORDER BY market_cap DESC
        LIMIT 10
      `);
      
      console.log('🔝 Top NEW tokens:');
      top.rows.forEach(t => {
        const scanned = t.last_scan_at ? '✓' : '✗';
        const age = formatAge(t.age);
        const marketCap = parseFloat(t.market_cap || 0).toFixed(0).padStart(7);
        console.log(`   ${scanned} ${t.symbol.padEnd(10)} ${marketCap} - ${age} old, ${t.category_scan_count || 0} scans`);
      });
      
      // Recent transitions from NEW
      const transitions = await pool.query(`
        SELECT 
          t.symbol,
          ct.from_category,
          ct.to_category,
          ct.market_cap_at_transition,
          ct.created_at
        FROM category_transitions ct
        JOIN tokens t ON t.address = ct.token_address
        WHERE ct.from_category = 'NEW'
          AND ct.created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY ct.created_at DESC
        LIMIT 5
      `);
      
      if (transitions.rows.length > 0) {
        console.log('\n🔄 Recent promotions:');
        transitions.rows.forEach(t => {
          const time = new Date(t.created_at).toLocaleTimeString();
          console.log(`   ${time} ${t.symbol} → ${t.to_category} ($${t.market_cap_at_transition})`);
        });
      }
      
      // Scan activity
      const scanActivity = await pool.query(`
        SELECT 
          COUNT(DISTINCT token_address) as tokens,
          COUNT(*) as scans
        FROM scan_logs
        WHERE category = 'NEW'
          AND created_at > NOW() - INTERVAL '5 minutes'
      `);
      
      if (scanActivity.rows[0].scans > 0) {
        console.log(`\n📡 Scan activity (5 min): ${scanActivity.rows[0].tokens} tokens, ${scanActivity.rows[0].scans} scans`);
      }
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

function formatAge(interval) {
  if (!interval) return 'unknown';
  
  // PostgreSQL interval comes as an object
  if (typeof interval === 'object') {
    const hours = interval.hours || 0;
    const minutes = interval.minutes || 0;
    const days = interval.days || 0;
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
  
  // Handle string format
  const intervalStr = String(interval);
  const match = intervalStr.match(/(\d+):(\d+):(\d+)/);
  if (!match) return intervalStr;
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

watchNewTokens().catch(console.error);