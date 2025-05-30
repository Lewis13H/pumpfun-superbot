// check-db-stats.ts
import knex from 'knex';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Create database connection with correct port
const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: 5433, // Use the actual port PostgreSQL is running on
    user: 'memecoin_user', // Based on the docs, this seems to be the actual user
    password: process.env.POSTGRES_PASSWORD || 'your_actual_password', // You need to set this
    database: 'memecoin_discovery', // Based on the docs, this seems to be the actual database
  },
  pool: {
    min: 2,
    max: 10,
  },
});

async function checkDatabaseStats() {
  console.log('\n🔍 Checking Database Statistics...\n');
  
  try {
    // 1. Count all tokens
    const totalTokens = await db('tokens').count('* as count').first();
    console.log(`📊 Total Tokens: ${totalTokens?.count || 0}`);
    
    // 2. Count pump.fun tokens
    const pumpFunTokens = await db('tokens')
      .where('is_pump_fun', true)
      .count('* as count')
      .first();
    console.log(`🎯 PumpFun Tokens: ${pumpFunTokens?.count || 0}`);
    
    // 3. Tokens discovered in last 24 hours
    const recentTokens = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .count('* as count')
      .first();
    console.log(`⏰ Tokens (24h): ${recentTokens?.count || 0}`);
    
    // 4. Tokens discovered in last hour
    const lastHourTokens = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .count('* as count')
      .first();
    console.log(`⚡ Tokens (1h): ${lastHourTokens?.count || 0}`);
    
    // 5. Check today's API costs
    const todayCosts = await db('api_call_logs')
      .whereRaw('DATE(timestamp) = CURRENT_DATE')
      .sum('cost as total')
      .count('* as calls')
      .first();
    console.log(`\n💰 Today's API Usage:`);
    console.log(`   Total Cost: $${(todayCosts?.total || 0).toFixed(2)}`);
    console.log(`   API Calls: ${todayCosts?.calls || 0}`);
    
    // 6. API costs by tier (if analysis_tier is tracked)
    console.log(`\n📈 Analysis by Tier:`);
    const tierStats = await db('tokens')
      .select('analysis_tier')
      .count('* as count')
      .groupBy('analysis_tier')
      .orderBy('count', 'desc');
    
    tierStats.forEach((tier: any) => {
      console.log(`   ${tier.analysis_tier || 'UNKNOWN'}: ${tier.count} tokens`);
    });
    
    // 7. Investment classifications
    console.log(`\n🎯 Investment Classifications:`);
    const classifications = await db('tokens')
      .select('investment_classification')
      .count('* as count')
      .whereNotNull('investment_classification')
      .groupBy('investment_classification')
      .orderBy('count', 'desc');
    
    classifications.forEach((cls: any) => {
      console.log(`   ${cls.investment_classification}: ${cls.count} tokens`);
    });
    
    // 8. Top 10 recent tokens
    console.log(`\n🆕 Recent Token Discoveries:`);
    const recentTokensList = await db('tokens')
      .select('symbol', 'name', 'address', 'is_pump_fun', 'analysis_tier', 'composite_score', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(10);
    
    console.log(`\n   Symbol | Name | PumpFun | Tier | Score | Created`);
    console.log(`   -------|------|---------|------|-------|--------`);
    recentTokensList.forEach((token: any) => {
      const symbol = (token.symbol || 'N/A').padEnd(6).substring(0, 6);
      const name = (token.name || 'Unknown').padEnd(20).substring(0, 20);
      const isPump = token.is_pump_fun ? 'Yes' : 'No';
      const tier = (token.analysis_tier || 'N/A').padEnd(8).substring(0, 8);
      const score = token.composite_score ? token.composite_score.toFixed(3) : 'N/A';
      const created = new Date(token.created_at).toLocaleString();
      
      console.log(`   ${symbol} | ${name.substring(0, 5)} | ${isPump.padEnd(7)} | ${tier} | ${score.padEnd(5)} | ${created}`);
    });
    
    // 9. Database table sizes
    console.log(`\n📊 Database Table Statistics:`);
    const tableStats = await db.raw(`
      SELECT 
        tablename,
        n_live_tup as rows,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_stat_user_tables 
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
      LIMIT 10
    `);
    
    console.log(`\n   Table Name | Rows | Size`);
    console.log(`   -----------|------|------`);
    tableStats.rows.forEach((table: any) => {
      const name = table.tablename.padEnd(25).substring(0, 25);
      const rows = table.rows.toString().padEnd(10);
      console.log(`   ${name} | ${rows} | ${table.size}`);
    });
    
    // 10. Export recent tokens to CSV
    const exportData = await db('tokens')
      .select('*')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .orderBy('created_at', 'desc');
    
    if (exportData.length > 0) {
      const csv = convertToCSV(exportData);
      const filename = `recent_tokens_${new Date().toISOString().split('T')[0]}.csv`;
      fs.writeFileSync(filename, csv);
      console.log(`\n✅ Exported ${exportData.length} recent tokens to ${filename}`);
    }
    
    // 11. Check graduation tracking
    console.log(`\n🎓 Graduation Tracking:`);
    const graduationStats = await db('pump_fun_curve_snapshots')
      .select(db.raw('COUNT(DISTINCT token_address) as tokens'))
      .select(db.raw('COUNT(*) as snapshots'))
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .first();
    
    console.log(`   Tracked Tokens: ${graduationStats?.tokens || 0}`);
    console.log(`   Snapshots (24h): ${graduationStats?.snapshots || 0}`);
    
    // 12. Find tokens close to graduation
    const nearGraduation = await db('tokens')
      .select('symbol', 'name', 'market_cap', 'distance_to_graduation')
      .where('market_cap', '>', 50000)
      .where('is_pump_fun', true)
      .orderBy('market_cap', 'desc')
      .limit(5);
    
    if (nearGraduation.length > 0) {
      console.log(`\n🚀 Tokens Approaching Graduation ($69,420):`);
      nearGraduation.forEach((token: any) => {
        const progress = ((token.market_cap / 69420) * 100).toFixed(1);
        console.log(`   ${token.symbol}: ${token.market_cap?.toFixed(0)} (${progress}% of target)`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvHeaders = headers.join(',');
  
  const csvRows = data.map(row => {
    return headers.map(header => {
      const value = row[header];
      // Handle nulls, quotes, and commas in values
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',');
  });
  
  return [csvHeaders, ...csvRows].join('\n');
}

// Run the check
checkDatabaseStats();