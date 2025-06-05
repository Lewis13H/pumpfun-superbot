// scripts/db-dashboard.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

async function displayDashboard() {
  while (true) {
    try {
      console.clear();
      console.log(`${colors.cyan}${colors.bright}🚀 MEMECOIN SCANNER V3.5 DASHBOARD${colors.reset}`);
      console.log(`${colors.cyan}${'='.repeat(50)}${colors.reset}`);
      console.log(`${colors.gray}Last Update: ${new Date().toLocaleTimeString()}${colors.reset}\n`);
      
      // Category Distribution
      const categories = await pool.query(`
        SELECT 
          category,
          COUNT(*) as count,
          COUNT(CASE WHEN last_scan_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as active,
          ROUND(AVG(market_cap)) as avg_mc,
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
      
      console.log(`${colors.yellow}📊 CATEGORY DISTRIBUTION:${colors.reset}`);
      categories.rows.forEach(row => {
        const highlight = row.category === 'AIM' ? colors.green : '';
        console.log(`  ${highlight}${row.category.padEnd(8)} ${row.count.toString().padStart(6)} tokens | ${row.active.toString().padStart(4)} active | MC: ${Math.round(parseFloat(row.avg_mc || 0))}${colors.reset}`);
      });
      
      // Hot Movements
      const movements = await pool.query(`
        SELECT 
          t.symbol,
          ct.from_category,
          ct.to_category,
          ct.market_cap_at_transition as mc,
          ct.created_at
        FROM category_transitions ct
        JOIN tokens t ON t.address = ct.token_address
        WHERE ct.created_at > NOW() - INTERVAL '10 minutes'
          AND ct.from_category != ct.to_category
          AND ct.to_category IN ('HIGH', 'AIM', 'ARCHIVE')
        ORDER BY ct.created_at DESC
        LIMIT 8
      `);
      
      console.log(`\n${colors.yellow}🔥 HOT MOVEMENTS (10 min):${colors.reset}`);
      movements.rows.forEach(row => {
        const emoji = row.to_category === 'AIM' ? '🎯' : row.to_category === 'HIGH' ? '📈' : '🏆';
        console.log(`  ${emoji} ${row.symbol.padEnd(10)} ${row.from_category.padEnd(6)} → ${row.to_category.padEnd(7)} ${Math.round(parseFloat(row.mc || 0)).toString().padStart(8)}`);
      });
      
      // Scan Activity
      const scans = await pool.query(`
        SELECT 
          category,
          COUNT(DISTINCT token_address) as unique_tokens,
          COUNT(*) as total_scans,
          ROUND(COUNT(*) / 5.0, 1) as rate_per_min
        FROM scan_logs
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        GROUP BY category
        ORDER BY total_scans DESC
      `);
      
      console.log(`\n${colors.yellow}⚡ SCAN ACTIVITY (5 min):${colors.reset}`);
      scans.rows.forEach(row => {
        console.log(`  ${row.category.padEnd(8)} ${row.unique_tokens.toString().padStart(4)} tokens | ${row.total_scans.toString().padStart(5)} scans | Rate: ${row.rate_per_min}/min`);
      });
      
      // Discovery Rate
      const discovery = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) / 10.0 as per_minute
        FROM tokens
        WHERE created_at > NOW() - INTERVAL '10 minutes'
      `);
      
      console.log(`\n${colors.yellow}📈 DISCOVERY RATE:${colors.reset} ${discovery.rows[0].total} tokens in 10 min (${parseFloat(discovery.rows[0].per_minute).toFixed(1)}/min)`);
      
      // Top Gainers
      const gainers = await pool.query(`
        SELECT 
          symbol,
          category,
          market_cap,
          created_at
        FROM tokens
        WHERE market_cap > 50000
          AND created_at > NOW() - INTERVAL '1 hour'
        ORDER BY market_cap DESC
        LIMIT 5
      `);
      
      if (gainers.rows.length > 0) {
        console.log(`\n${colors.yellow}🏆 TOP GAINERS (1hr):${colors.reset}`);
        gainers.rows.forEach(row => {
          const age = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 60000);
          console.log(`  ${row.symbol.padEnd(10)} ${row.category.padEnd(7)} ${Math.round(parseFloat(row.market_cap || 0)).toString().padStart(8)} (${age}min old)`);
        });
      }
      
    } catch (error) {
      console.error(`${colors.red}Dashboard error: ${error.message}${colors.reset}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down dashboard...');
  await pool.end();
  process.exit(0);
});

// Start dashboard
console.log('Starting dashboard...\n');
displayDashboard().catch(console.error);