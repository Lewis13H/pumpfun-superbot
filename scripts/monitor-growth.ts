import { db } from '../src/database/postgres';

async function monitorTokenGrowth() {
  console.log('📊 Monitoring Token Growth (updates every 30 seconds)\n');
  
  let lastCount = 0;
  
  setInterval(async () => {
    try {
      const count = await db('tokens').count('* as total');
      const currentCount = Number(count[0].total);
      const newTokens = currentCount - lastCount;
      
      const recent = await db('tokens')
        .orderBy('created_at', 'desc')
        .limit(3)
        .select('symbol', 'name', 'created_at');
      
      console.clear();
      console.log(`📊 Token Discovery Monitor - ${new Date().toLocaleTimeString()}`);
      console.log(`\n✅ Total Tokens: ${currentCount}`);
      console.log(`📈 New in last 30s: ${newTokens}`);
      console.log(`⚡ Rate: ${(newTokens * 2)} tokens/minute`);
      
      console.log('\n🆕 Latest Tokens:');
      recent.forEach((t: any) => {
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 1000);
        console.log(`   ${t.symbol} - ${t.name} (${age}s ago)`);
      });
      
      lastCount = currentCount;
      
    } catch (error) {
      // Ignore errors to keep monitoring
    }
  }, 30000);
}

monitorTokenGrowth();
