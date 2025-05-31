import { db } from '../src/database/postgres';

async function getSimpleSummary() {
  console.log('📊 Token Discovery System - Summary\n');
  
  try {
    // Total tokens
    const total = await db('tokens').count('* as count');
    console.log(`✅ Total Tokens: ${total[0].count}`);
    
    // Recent tokens
    const recent = await db('tokens')
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('symbol', 'name', 'market_cap', 'platform', 'created_at');
    
    console.log('\n🆕 Latest 10 Tokens:');
    recent.forEach((t: any, i: number) => {
      console.log(`${i+1}. ${t.symbol} - ${t.name} ($${t.market_cap || 0})`);
    });
    
    // Platform count
    const platforms = await db('tokens')
      .select('platform')
      .count('* as count')
      .groupBy('platform');
    
    console.log('\n📈 By Platform:');
    platforms.forEach((p: any) => {
      console.log(`  ${p.platform}: ${p.count} tokens`);
    });
    
    // API costs
    const totalCost = await db('api_call_logs')
      .sum('cost as total');
    
    console.log(`\n💰 Total API Cost: $${parseFloat(totalCost[0]?.total || '0').toFixed(3)}`);
    
    // Tokens in last hour
    const lastHour = await db('tokens')
      .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
      .count('* as count');
    
    console.log(`⏰ Tokens in last hour: ${lastHour[0].count}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

getSimpleSummary();
