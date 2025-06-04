// scripts/force-scan-new.js
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

async function scanNewTokens() {
  console.log('🚀 Force scanning NEW tokens...\n');
  
  const stats = {
    scanned: 0,
    upgraded: 0,
    errors: 0,
    startTime: Date.now()
  };
  
  try {
    // Get all NEW tokens
    const newTokens = await pool.query(`
      SELECT address, symbol, market_cap, created_at
      FROM tokens
      WHERE category = 'NEW'
      ORDER BY created_at DESC
    `);
    
    console.log(`Found ${newTokens.rows.length} NEW tokens to scan\n`);
    
    for (const token of newTokens.rows) {
      try {
        // Try Birdeye
        const response = await axios.get(
          `https://public-api.birdeye.so/defi/token_overview?address=${token.address}`,
          {
            headers: {
              'Accept': 'application/json',
              'X-API-KEY': process.env.BIRDEYE_API_KEY
            },
            timeout: 5000
          }
        );
        
        const data = response.data.data;
        if (data && data.marketCap) {
          // Update market cap
          await pool.query(`
            UPDATE tokens 
            SET 
              market_cap = $1,
              liquidity = $2,
              holders = $3,
              volume_24h = $4,
              last_scan_at = NOW(),
              category_scan_count = category_scan_count + 1
            WHERE address = $5
          `, [
            data.marketCap,
            data.liquidity || 0,
            data.holder || null,
            data.v24hUSD || 0,
            token.address
          ]);
          
          // Log scan
          await pool.query(`
            INSERT INTO scan_logs 
            (token_address, category, scan_number, apis_called, created_at)
            VALUES ($1, 'NEW', 1, '["birdeye"]', NOW())
          `, [token.address]);
          
          stats.scanned++;
          
          if (data.marketCap >= 8000) {
            console.log(`⬆️  ${token.symbol}: $${token.market_cap} → $${data.marketCap}`);
            stats.upgraded++;
          } else {
            process.stdout.write('.');
          }
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        if (error.response?.status !== 404) {
          stats.errors++;
        }
      }
    }
    
    console.log(`\n\n✅ Scan complete!`);
    console.log(`   Scanned: ${stats.scanned}`);
    console.log(`   Upgraded: ${stats.upgraded}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Time: ${((Date.now() - stats.startTime) / 1000).toFixed(1)}s`);
    
    // Check results
    const results = await pool.query(`
      SELECT 
        CASE 
          WHEN market_cap < 8000 THEN 'Will stay NEW/LOW'
          WHEN market_cap < 19000 THEN 'Should be MEDIUM'
          WHEN market_cap < 35000 THEN 'Should be HIGH'
          WHEN market_cap <= 145000 THEN 'Should be AIM'
          ELSE 'Should be ARCHIVE'
        END as status,
        COUNT(*) as count,
        AVG(market_cap) as avg_mc
      FROM tokens
      WHERE category = 'NEW'
      GROUP BY CASE 
        WHEN market_cap < 8000 THEN 'Will stay NEW/LOW'
        WHEN market_cap < 19000 THEN 'Should be MEDIUM'
        WHEN market_cap < 35000 THEN 'Should be HIGH'
        WHEN market_cap <= 145000 THEN 'Should be AIM'
        ELSE 'Should be ARCHIVE'
      END
      ORDER BY avg_mc DESC
    `);
    
    console.log('\n📊 NEW Token Status:');
    console.table(results.rows);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

scanNewTokens().catch(console.error);