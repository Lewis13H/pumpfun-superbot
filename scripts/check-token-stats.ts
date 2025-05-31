import { db } from '../src/database/postgres';

async function checkTokenStats() {
  try {
    console.log('=== Token Discovery Stats ===\n');
    
    // Total tokens
    const totalTokens = await db('tokens').count('* as count');
    console.log(`Total tokens in database: ${totalTokens[0].count}`);
    
    // Tokens by platform
    const byPlatform = await db('tokens')
      .select('platform')
      .count('* as count')
      .groupBy('platform');
    
    console.log('\nTokens by platform:');
    byPlatform.forEach(p => {
      console.log(`  ${p.platform || 'unknown'}: ${p.count}`);
    });
    
    // Recent tokens (last 24 hours)
    const recentTokens = await db('tokens')
      .where('created_at', '>', new Date(Date.now() - 86400000))
      .select('address', 'symbol', 'name', 'platform', 'created_at', 'market_cap')
      .orderBy('created_at', 'desc')
      .limit(10);
    
    console.log(`\nTokens discovered in last 24 hours: ${recentTokens.length}`);
    
    if (recentTokens.length > 0) {
      console.log('\nMost recent tokens:');
      recentTokens.forEach(token => {
        const age = Math.floor((Date.now() - new Date(token.created_at).getTime()) / 60000);
        console.log(`  ${token.symbol || 'NO_SYMBOL'} - ${token.platform} - ${age} minutes ago - $${token.market_cap || 0}`);
      });
    }
    
    // Check filtered tokens
    const filteredCount = await db('filtered_tokens').count('* as count');
    console.log(`\nTokens filtered out: ${filteredCount[0].count}`);
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkTokenStats();
