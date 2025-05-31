import { db } from '../src/database/postgres';

async function checkSystemStatus() {
  try {
    console.log('=== DISCOVERY SYSTEM STATUS ===\n');
    
    // Total tokens
    const totalTokens = await db('tokens').count('* as count');
    console.log(`Total tokens discovered: ${totalTokens[0].count}`);
    
    // Tokens by status
    const byStatus = await db('tokens')
      .select('analysis_status')
      .count('* as count')
      .groupBy('analysis_status');
    
    console.log('\nTokens by analysis status:');
    byStatus.forEach(s => {
      console.log(`  ${s.analysis_status || 'NULL'}: ${s.count}`);
    });
    
    // Recent discoveries (last hour)
    const recentTokens = await db('tokens')
      .where('created_at', '>', new Date(Date.now() - 3600000))
      .count('* as count');
    
    console.log(`\nTokens discovered in last hour: ${recentTokens[0].count}`);
    
    // Tokens with complete metadata
    const completeMetadata = await db('tokens')
      .whereNotNull('creator')
      .whereNotNull('bonding_curve')
      .where('platform', 'pumpfun')
      .count('* as count');
    
    console.log(`\nPump.fun tokens with complete metadata: ${completeMetadata[0].count}`);
    
    // Market cap distribution
    const marketCapRanges = await db.raw(`
      SELECT 
        CASE 
          WHEN market_cap = 0 THEN '0'
          WHEN market_cap < 1000 THEN '<$1K'
          WHEN market_cap < 5000 THEN '$1K-5K'
          WHEN market_cap < 10000 THEN '$5K-10K'
          WHEN market_cap < 50000 THEN '$10K-50K'
          ELSE '>$50K'
        END as range,
        COUNT(*) as count
      FROM tokens
      GROUP BY range
      ORDER BY 
        CASE range
          WHEN '0' THEN 1
          WHEN '<$1K' THEN 2
          WHEN '$1K-5K' THEN 3
          WHEN '$5K-10K' THEN 4
          WHEN '$10K-50K' THEN 5
          ELSE 6
        END
    `);
    
    console.log('\nMarket cap distribution:');
    marketCapRanges.rows.forEach((r: any) => {
      console.log(`  ${r.range}: ${r.count} tokens`);
    });
    
    // API costs
    const todayCosts = await db('api_call_logs')
      .where('timestamp', '>', new Date(new Date().setHours(0,0,0,0)))
      .sum('cost as total');
    
    console.log(`\nAPI costs today: $${(todayCosts[0].total || 0).toFixed(4)}`);
    
    // Current filter
    const activeFilter = await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .first();
    
    if (activeFilter) {
      console.log(`\nActive filter: ${activeFilter.setting_value.name || 'unknown'}`);
    }
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkSystemStatus();
