// scripts/watch-categories.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function watchCategories() {
  console.log('📊 Real-time Category Monitor\n');
  
  let lastStats = {};
  
  while (true) {
    try {
      // Get current distribution
      const dist = await pool.query(`
        SELECT 
          category,
          COUNT(*) as count,
          COUNT(CASE WHEN last_scan_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as recently_scanned,
          MIN(market_cap) as min_mc,
          MAX(market_cap) as max_mc,
          AVG(market_cap) as avg_mc
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
      
      // Get misplaced tokens
      const misplaced = await pool.query(`
        SELECT COUNT(*) as total_misplaced
        FROM tokens
        WHERE market_cap > 0
          AND category != 
            CASE 
              WHEN market_cap < 8000 THEN 'LOW'
              WHEN market_cap < 19000 THEN 'MEDIUM'
              WHEN market_cap < 35000 THEN 'HIGH'
              WHEN market_cap <= 145000 THEN 'AIM'
              ELSE 'ARCHIVE'
            END
      `);
      
      // Get recent transitions
      const transitions = await pool.query(`
        SELECT 
          from_category,
          to_category,
          COUNT(*) as count
        FROM category_transitions
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        GROUP BY from_category, to_category
        ORDER BY count DESC
        LIMIT 5
      `);
      
      // Clear screen and show data
      console.clear();
      console.log(`📊 CATEGORY MONITOR - ${new Date().toLocaleTimeString()}\n`);
      
      console.log('Current Distribution:');
      console.table(dist.rows.map(row => ({
        Category: row.category,
        Count: parseInt(row.count),
        Change: lastStats[row.category] ? parseInt(row.count) - lastStats[row.category] : 0,
        'Recent Scans': parseInt(row.recently_scanned),
        'Min MC': parseFloat(row.min_mc).toFixed(0),
        'Max MC': parseFloat(row.max_mc).toFixed(0),
        'Avg MC': parseFloat(row.avg_mc).toFixed(0)
      })));
      
      console.log(`\n⚠️  Misplaced Tokens: ${misplaced.rows[0].total_misplaced}`);
      
      if (transitions.rows.length > 0) {
        console.log('\nRecent Transitions (last 5 min):');
        console.table(transitions.rows);
      }
      
      // Update last stats
      dist.rows.forEach(row => {
        lastStats[row.category] = parseInt(row.count);
      });
      
      // Show tokens that should be AIM
      const shouldBeAim = await pool.query(`
        SELECT symbol, market_cap, category
        FROM tokens
        WHERE market_cap >= 35000 
          AND market_cap <= 145000
          AND category != 'AIM'
        ORDER BY market_cap DESC
        LIMIT 5
      `);
      
      if (shouldBeAim.rows.length > 0) {
        console.log('\n🎯 Tokens that should be AIM:');
        console.table(shouldBeAim.rows);
      }
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000)); // Update every 5 seconds
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

watchCategories().catch(console.error);