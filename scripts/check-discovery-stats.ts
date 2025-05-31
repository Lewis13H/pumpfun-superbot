import { db } from '../src/database/postgres';

async function checkDiscoveryStats() {
  try {
    console.log('=== Discovery System Stats ===\n');
    
    // Check tokens discovered in last hour
    const recentTokens = await db('tokens')
      .where('created_at', '>', new Date(Date.now() - 3600000))
      .orderBy('created_at', 'desc')
      .limit(10);
    
    console.log(`Tokens discovered in last hour: ${recentTokens.length}`);
    
    // Check if metadata is complete
    const incompleteTokens = await db('tokens')
      .whereNull('symbol')
      .orWhereNull('name')
      .orWhereNull('decimals')
      .count('* as count');
    
    console.log(`Tokens with incomplete metadata: ${incompleteTokens[0].count}`);
    
    // Show recent token details
    console.log('\nMost recent tokens:');
    recentTokens.forEach((token: any) => {
      console.log(`- ${token.symbol || 'NO_SYMBOL'} (${token.address.substring(0,8)}...)`);
      console.log(`  Platform: ${token.platform}, Created: ${token.created_at}`);
      console.log(`  Has metadata: ${token.name ? 'Yes' : 'No'}`);
    });
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkDiscoveryStats();
