import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';
import { categoryAPIRouter } from '../src/analysis/category-api-router';

async function testAimBuySignal() {
  try {
    console.log('=== Testing AIM Buy Signal with Real Token ===\n');
    
    // Find a HIGH token to promote
    let candidate = await db('tokens')
      .where('category', 'HIGH')
      .orderBy('market_cap', 'desc')
      .first();
    
    if (!candidate) {
      console.log('No HIGH tokens found. Creating test token...');
      
      // Create a test token directly in AIM
      await db('tokens').insert({
        address: 'AIM_BUY_TEST_001',
        symbol: 'AIMTEST',
        name: 'AIM Buy Test',
        category: 'HIGH',
        market_cap: 34000,
        liquidity: 12000,
        holders: 180,
        platform: 'test',
        created_at: new Date(),
        discovered_at: new Date(),
      }).onConflict('address').merge();
      
      candidate = await db('tokens').where('address', 'AIM_BUY_TEST_001').first();
    }
    
    console.log(`Using token: ${candidate.symbol} (${candidate.category}) at $${candidate.market_cap}`);
    
    // First, update the token with fresh market data
    console.log('\nFetching fresh market data...');
    const analysis = await categoryAPIRouter.analyzeToken(
      candidate.address,
      candidate.category,
      false
    );
    
    console.log(`Updated market data:`);
    console.log(`  Market Cap: $${analysis.marketCap}`);
    console.log(`  Liquidity: $${analysis.liquidity}`);
    
    // If still not in AIM range, manually set proper values
    if (analysis.marketCap < 35000 || analysis.liquidity < 7500) {
      console.log('\nManually setting AIM-eligible values for testing...');
      await db('tokens')
        .where('address', candidate.address)
        .update({
          market_cap: 42000,
          liquidity: 15000,
          holders: 200,
          top_10_percent: 22,
          solsniffer_score: 75,
          solsniffer_checked_at: new Date(),
        });
    }
    
    // Push to AIM category
    console.log('\nPromoting to AIM category...');
    await categoryManager.updateTokenMarketCap(candidate.address, 42000);
    
    // Wait for state transition
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify category change
    const updated = await db('tokens')
      .where('address', candidate.address)
      .first();
    
    console.log(`Token category: ${updated.category}`);
    
    if (updated.category === 'AIM') {
      console.log('\n=== Evaluating Buy Signal ===');
      
      // Show current token data
      console.log('\nToken data before evaluation:');
      console.log(`  Market Cap: $${updated.market_cap}`);
      console.log(`  Liquidity: $${updated.liquidity}`);
      console.log(`  Holders: ${updated.holders}`);
      console.log(`  Top 10%: ${updated.top_10_percent}%`);
      console.log(`  SolSniffer: ${updated.solsniffer_score}`);
      
      // Evaluate buy signal
      const evaluation = await buySignalEvaluator.evaluateToken(candidate.address);
      
      console.log('\n=== Evaluation Results ===');
      console.log(`Passed: ${evaluation.passed}`);
      console.log('\nCriteria:');
      console.log(`  Market Cap: ${evaluation.criteria.marketCap ? '✅' : '❌'} ($${evaluation.marketCap})`);
      console.log(`  Liquidity: ${evaluation.criteria.liquidity ? '✅' : '❌'} ($${evaluation.liquidity})`);
      console.log(`  Holders: ${evaluation.criteria.holders ? '✅' : '❌'} (${evaluation.holders})`);
      console.log(`  Concentration: ${evaluation.criteria.concentration ? '✅' : '❌'} (${evaluation.top10Percent}%)`);
      console.log(`  SolSniffer: ${evaluation.criteria.solsniffer ? '✅' : '❌'} (${evaluation.solsnifferScore})`);
      
      if (!evaluation.passed) {
        console.log('\nFailure reasons:');
        evaluation.failureReasons.forEach(reason => console.log(`  - ${reason}`));
      } else {
        console.log('\n✅ Buy signal PASSED!');
      }
    }
    
    // Clean up if test token
    if (candidate.address === 'AIM_BUY_TEST_001') {
      await db('tokens').where('address', candidate.address).delete();
      console.log('\nTest token cleaned up.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

testAimBuySignal();