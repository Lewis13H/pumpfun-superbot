import { db } from '../src/database/postgres';

async function checkGraduationTracking() {
  try {
    console.log('=== GRADUATION TRACKING STATUS ===\n');
    
    // Tokens with high curve progress
    const graduationCandidates = await db('tokens')
      .where('curve_progress', '>', 0.5)
      .orderBy('curve_progress', 'desc')
      .select('symbol', 'address', 'curve_progress', 'market_cap', 'distance_to_graduation');
    
    if (graduationCandidates.length > 0) {
      console.log('Tokens approaching graduation:');
      graduationCandidates.forEach(token => {
        const progress = (token.curve_progress * 100).toFixed(1);
        console.log(`  ${token.symbol}: ${progress}% (MC: $${token.market_cap}, Distance: $${token.distance_to_graduation})`);
      });
    } else {
      console.log('No tokens close to graduation (>50% progress)');
    }
    
    // Check for curve progress errors
    const invalidProgress = await db('tokens')
      .where('curve_progress', '>', 1)
      .count('* as count');
    
    console.log(`\nTokens with curve_progress > 100%: ${invalidProgress[0].count}`);
    
    // Recent graduation snapshots
    const recentSnapshots = await db('pump_fun_curve_snapshots')
      .orderBy('created_at', 'desc')
      .limit(5);
    
    if (recentSnapshots.length > 0) {
      console.log('\nRecent graduation tracking snapshots:');
      recentSnapshots.forEach(s => {
        console.log(`  ${new Date(s.created_at).toLocaleTimeString()}: Progress ${(s.curve_progress * 100).toFixed(1)}%`);
      });
    }
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkGraduationTracking();
