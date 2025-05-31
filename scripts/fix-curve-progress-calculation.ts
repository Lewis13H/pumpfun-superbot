import { db } from '../src/database/postgres';

async function fixCurveProgressCalculation() {
  try {
    console.log('Fixing curve progress calculations...\n');
    
    // Get all tokens with wrong curve progress
    const wrongProgress = await db('tokens')
      .where('curve_progress', '>', 1)
      .select('address', 'symbol', 'market_cap', 'curve_progress', 'distance_to_graduation');
    
    console.log(`Found ${wrongProgress.length} tokens with incorrect curve progress\n`);
    
    for (const token of wrongProgress) {
      // Recalculate correct values
      const marketCap = parseFloat(token.market_cap) || 0;
      const correctProgress = Math.min(marketCap / 69420, 1.0);
      const correctDistance = Math.max(69420 - marketCap, 0);
      
      console.log(`${token.symbol}:`);
      console.log(`  Market Cap: $${marketCap}`);
      console.log(`  Wrong Progress: ${(token.curve_progress * 100).toFixed(1)}%`);
      console.log(`  Correct Progress: ${(correctProgress * 100).toFixed(1)}%`);
      console.log(`  Correct Distance: $${correctDistance.toFixed(2)}\n`);
      
      // Update with correct values
      await db('tokens')
        .where('address', token.address)
        .update({
          curve_progress: correctProgress,
          distance_to_graduation: correctDistance
        });
    }
    
    console.log('✅ Fixed curve progress calculations');
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

fixCurveProgressCalculation();
