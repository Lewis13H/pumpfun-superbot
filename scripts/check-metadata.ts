import { db } from '../src/database/postgres';

async function checkMetadataCompleteness() {
  try {
    console.log('=== Token Metadata Analysis ===\n');
    
    // Get recent tokens with their metadata
    const recentTokens = await db('tokens')
      .orderBy('created_at', 'desc')
      .limit(5);
    
    console.log('Recent tokens and their metadata:');
    recentTokens.forEach(token => {
      console.log(`\n${token.symbol} (${token.address.substring(0,8)}...)`);
      console.log(`  Name: ${token.name || 'MISSING'}`);
      console.log(`  Decimals: ${token.decimals || 'MISSING'}`);
      console.log(`  Platform: ${token.platform}`);
      console.log(`  Creator: ${token.creator || 'MISSING'}`);
      console.log(`  Bonding Curve: ${token.bonding_curve ? 'YES' : 'NO'}`);
      console.log(`  Market Cap: $${token.market_cap || 0}`);
      console.log(`  Analysis Status: ${token.analysis_status}`);
    });
    
    // Check for missing critical data
    const missingData = await db('tokens')
      .whereNull('symbol')
      .orWhereNull('name')
      .orWhereNull('creator')
      .count('* as count');
    
    console.log(`\nTokens with missing critical data: ${missingData[0].count}`);
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkMetadataCompleteness();
