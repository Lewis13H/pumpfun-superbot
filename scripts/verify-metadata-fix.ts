import { db } from '../src/database/postgres';

async function verifyMetadataFix() {
  try {
    console.log('=== Verifying Metadata Fix ===\n');
    
    // Check recent pump.fun tokens
    const pumpfunTokens = await db('tokens')
      .where('platform', 'pumpfun')
      .whereNotNull('creator')
      .orderBy('created_at', 'desc')
      .limit(5);
    
    console.log(`Found ${pumpfunTokens.length} pump.fun tokens with creator data:\n`);
    
    pumpfunTokens.forEach(token => {
      console.log(`${token.symbol} (${token.address.substring(0,8)}...)`);
      console.log(`  Creator: ${token.creator ? '✓' : '✗'} ${token.creator?.substring(0,8) || ''}...`);
      console.log(`  Bonding Curve: ${token.bonding_curve ? '✓' : '✗'} ${token.bonding_curve?.substring(0,8) || ''}...`);
      console.log(`  Initial Price: ${token.initial_price_sol || 'N/A'} SOL`);
      console.log(`  Market Cap: $${token.market_cap}`);
      console.log(`  Progress: ${((token.curve_progress || 0) * 100).toFixed(1)}% to graduation`);
      console.log(`  Distance: $${token.distance_to_graduation || 0} to $69,420\n`);
    });
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

verifyMetadataFix();
