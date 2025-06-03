import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';

async function promoteAndTest() {
  try {
    // Find HIGH tokens close to AIM
    const candidate = await db('tokens')
      .where('category', 'HIGH')
      .where('market_cap', '>', 30000)
      .orderBy('market_cap', 'desc')
      .first();
    
    if (!candidate) {
      console.log('No HIGH tokens close to AIM found');
      return;
    }
    
    console.log(`Found candidate: ${candidate.symbol} at $${candidate.market_cap}`);
    
    // Simulate market cap increase to push into AIM
    const newMarketCap = 36000;
    console.log(`\nSimulating market cap increase to $${newMarketCap}...`);
    
    await categoryManager.updateTokenMarketCap(candidate.address, newMarketCap);
    
    // Wait for state transition
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if now in AIM
    const updated = await db('tokens')
      .where('address', candidate.address)
      .first();
    
    console.log(`Token category: ${updated.category}`);
    
    if (updated.category === 'AIM') {
      // Add required data for buy signal evaluation
      await db('tokens')
        .where('address', candidate.address)
        .update({
          solsniffer_score: 75,
          solsniffer_checked_at: new Date(),
          top_10_percent: 22,
          holders: 150
        });
      
      console.log('\nEvaluating buy signal...');
      const evaluation = await buySignalEvaluator.evaluateToken(candidate.address);
      
      console.log('Evaluation passed:', evaluation.passed);
      if (!evaluation.passed) {
        console.log('Failure reasons:', evaluation.failureReasons);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

promoteAndTest();