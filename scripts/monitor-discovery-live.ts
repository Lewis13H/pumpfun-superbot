import { db } from '../src/database/postgres';
import { table } from 'console';

async function monitorLive() {
  console.clear();
  console.log('=== Live Discovery Monitor ===\n');
  
  setInterval(async () => {
    // Get last 10 tokens
    const recent = await db('tokens')
      .orderBy('discovered_at', 'desc')
      .limit(10)
      .select(
        'symbol',
        'category',
        'market_cap',
        'current_price',
        'liquidity',
        db.raw("to_char(discovered_at, 'HH24:MI:SS') as time")
      );
    
    // Get category counts
    const categories = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category')
      .orderBy('category');
    
    console.clear();
    console.log('=== Live Discovery Monitor ===');
    console.log(`Time: ${new Date().toLocaleTimeString()}\n`);
    
    console.log('Category Distribution:');
    categories.forEach(c => {
      console.log(`  ${c.category}: ${c.count}`);
    });
    
    console.log('\nRecent Discoveries:');
    console.table(recent);
    
  }, 2000); // Update every 2 seconds
}

monitorLive();
