import { db } from '../src/database/postgres';

async function getDataSummary() {
  console.log('📊 Token Discovery System - Data Summary\n');
  
  try {
    // Total tokens
    const total = await db('tokens').count('* as count');
    console.log(`✅ Total Tokens: ${total[0].count}`);
    
    // Age distribution
    const ageGroups = await db.raw(`
      SELECT 
        CASE 
          WHEN created_at > NOW() - INTERVAL '1 hour' THEN 'Last Hour'
          WHEN created_at > NOW() - INTERVAL '6 hours' THEN '1-6 Hours'
          WHEN created_at > NOW() - INTERVAL '24 hours' THEN '6-24 Hours'
          ELSE 'Older'
        END as age_group,
        COUNT(*) as count
      FROM tokens
      GROUP BY age_group
      ORDER BY 
        CASE age_group
          WHEN 'Last Hour' THEN 1
          WHEN '1-6 Hours' THEN 2
          WHEN '6-24 Hours' THEN 3
          ELSE 4
        END
    `);
    
    console.log('\n⏰ Token Age Distribution:');
    ageGroups.rows.forEach((g: any) => {
      console.log(`  ${g.age_group}: ${g.count} tokens`);
    });
    
    // Market cap distribution
    const mcGroups = await db.raw(`
      SELECT 
        CASE 
          WHEN market_cap = 0 OR market_cap IS NULL THEN 'No Data'
          WHEN market_cap < 1000 THEN '<$1K'
          WHEN market_cap < 10000 THEN '$1K-$10K'
          WHEN market_cap < 50000 THEN '$10K-$50K'
          ELSE '>$50K'
        END as mc_group,
        COUNT(*) as count
      FROM tokens
      GROUP BY mc_group
      ORDER BY 
        CASE mc_group
          WHEN 'No Data' THEN 1
          WHEN '<$1K' THEN 2
          WHEN '$1K-$10K' THEN 3
          WHEN '$10K-$50K' THEN 4
          ELSE 5
        END
    `);
    
    console.log('\n💰 Market Cap Distribution:');
    mcGroups.rows.forEach((g: any) => {
      console.log(`  ${g.mc_group}: ${g.count} tokens`);
    });
    
    // API usage
    const apiCalls = await db('api_call_logs')
      .select('service')
      .count('* as calls')
      .sum('cost as total_cost')
      .groupBy('service');
    
    console.log('\n📡 API Usage:');
    let totalCost = 0;
    apiCalls.forEach((api: any) => {
      const cost = parseFloat(api.total_cost || '0');
      totalCost += cost;
      console.log(`  ${api.service}: ${api.calls} calls ($${cost.toFixed(3)})`);
    });
    console.log(`  Total Cost: $${totalCost.toFixed(3)}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

getDataSummary();
