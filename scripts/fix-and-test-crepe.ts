import { db } from '../src/database/postgres';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';

async function fixAndTestCrepe() {
  try {
    const token = await db('tokens')
      .where('symbol', 'CREPE')
      .first();
    
    if (!token) {
      console.log('CREPE token not found');
      return;
    }
    
    console.log('Current CREPE data:');
    console.log(`  Category: ${token.category}`);
    console.log(`  Market Cap: $${token.market_cap}`);
    console.log(`  Liquidity: $${token.liquidity}`);
    
    // Update with AIM-eligible values
    console.log('\nUpdating CREPE to AIM-eligible values...');
    await db('tokens')
      .where('address', token.address)
      .update({
        market_cap: 45000,
        liquidity: 12000,
        holders: 150,
        top_10_percent: 20,
        solsniffer_score: 80,
        solsniffer_checked_at: new Date(),
      });
    
    // Evaluate
    console.log('\nEvaluating buy signal...');
    const evaluation = await buySignalEvaluator.evaluateToken(token.address);
    
    console.log(`\nPassed: ${evaluation.passed}`);
    if (!evaluation.passed) {
      console.log('Failures:', evaluation.failureReasons);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

fixAndTestCrepe();