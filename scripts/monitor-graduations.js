// scripts/monitor-graduations.js
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function monitorGraduations() {
  console.log('🎓 Monitoring Pump.fun Graduation Candidates\n');
  
  while (true) {
    try {
      // Get all tokens near graduation
      const candidates = await pool.query(`
        SELECT 
          address,
          symbol,
          market_cap,
          category,
          bonding_curve,
          curve_progress,
          distance_to_graduation,
          liquidity,
          holders,
          created_at
        FROM tokens
        WHERE platform = 'pumpfun'
          AND market_cap >= 50000
          AND category != 'ARCHIVE'
        ORDER BY market_cap DESC
      `);
      
      console.clear();
      console.log(`🎓 GRADUATION MONITOR - ${new Date().toLocaleTimeString()}\n`);
      console.log('Tokens approaching graduation ($69,000):\n');
      
      for (const token of candidates.rows) {
        const progress = (token.market_cap / 69000 * 100).toFixed(1);
        const timeAlive = ((Date.now() - new Date(token.created_at).getTime()) / 1000 / 60).toFixed(0);
        
        let status = '📈';
        if (token.market_cap >= 69000) status = '🎯';
        else if (token.market_cap >= 65000) status = '🔥';
        else if (token.market_cap >= 60000) status = '⚡';
        
        console.log(`${status} ${token.symbol.padEnd(12)} $${token.market_cap.toFixed(0).padStart(7)} (${progress}%) - ${token.category.padEnd(7)} - ${timeAlive}min old`);
        
        // Check if graduated but not archived
        if (token.market_cap >= 69000 && token.category !== 'ARCHIVE') {
          console.log(`   ⚠️  GRADUATED but still in ${token.category}! Checking Raydium...`);
          
          // Check if it has a Raydium pool
          try {
            const dexData = await axios.get(
              `https://api.dexscreener.com/latest/dex/tokens/${token.address}`,
              { timeout: 5000 }
            );
            
            if (dexData.data?.pairs?.length > 0) {
              const raydiumPair = dexData.data.pairs.find(p => p.dexId === 'raydium');
              if (raydiumPair) {
                console.log(`   ✅ CONFIRMED: Raydium pool found! LP: $${raydiumPair.liquidity?.usd || 0}`);
                
                // Update to ARCHIVE
                await pool.query(
                  `UPDATE tokens SET category = 'ARCHIVE', graduated = true WHERE address = $1`,
                  [token.address]
                );
              }
            }
          } catch (e) {
            // Ignore API errors
          }
        }
      }
      
      // Show category summary
      const summary = await pool.query(`
        SELECT 
          category,
          COUNT(*) as count,
          SUM(CASE WHEN market_cap >= 60000 THEN 1 ELSE 0 END) as near_grad,
          SUM(CASE WHEN market_cap >= 69000 THEN 1 ELSE 0 END) as graduated
        FROM tokens
        WHERE platform = 'pumpfun'
          AND category != 'BIN'
        GROUP BY category
      `);
      
      console.log('\n📊 Category Summary:');
      console.table(summary.rows);
      
    } catch (error) {
      console.error('Error:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 10000)); // Update every 10 seconds
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

monitorGraduations().catch(console.error);