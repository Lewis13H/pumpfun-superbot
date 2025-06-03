import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';
import { positionSizer } from '../src/trading/position-sizer';

async function testBuySignal() {
  try {
    console.log('=== Buy Signal Test ===\n');
    
    // Create a test AIM token
    const testToken = {
      address: 'TEST_AIM_TOKEN_001',
      symbol: 'AIMTEST',
      name: 'AIM Test Token',
      category: 'AIM',
      market_cap: 45000,
      liquidity: 15000,
      holders: 200,
      top_10_percent: 20,
      solsniffer_score: 85,
      solsniffer_checked_at: new Date(),
      platform: 'test',
      created_at: new Date(),
      discovered_at: new Date(),
    };
    
    console.log('Creating test AIM token...');
    await db('tokens').insert(testToken).onConflict('address').merge();
    
    // Create state machine
    await categoryManager.createOrRestoreStateMachine(
      testToken.address,
      'AIM',
      { currentMarketCap: testToken.market_cap }
    );
    
    console.log('Test token created:', testToken.symbol);
    console.log('Market Cap:', testToken.market_cap);
    console.log('Category:', testToken.category);
    
    // Test buy signal evaluation
    console.log('\nEvaluating buy signal...');
    
    const evaluation = await buySignalEvaluator.evaluateToken(testToken.address);
    
    console.log('\n=== Evaluation Results ===');
    console.log('Passed:', evaluation.passed);
    console.log('\nCriteria:');
    console.log('  Market Cap:', evaluation.criteria.marketCap ? '✅' : '❌');
    console.log('  Liquidity:', evaluation.criteria.liquidity ? '✅' : '❌');
    console.log('  Holders:', evaluation.criteria.holders ? '✅' : '❌');
    console.log('  Concentration:', evaluation.criteria.concentration ? '✅' : '❌');
    console.log('  SolSniffer:', evaluation.criteria.solsniffer ? '✅' : '❌');
    
    if (!evaluation.passed) {
      console.log('\nFailure Reasons:');
      evaluation.failureReasons.forEach(reason => {
        console.log('  -', reason);
      });
    } else {
      // Calculate position size
      const position = positionSizer.calculatePosition(evaluation);
      console.log('\n=== Position Sizing ===');
      console.log('Base Position:', position.basePosition, 'SOL');
      console.log('Final Position:', position.finalPosition, 'SOL');
      console.log('Reasoning:');
      position.reasoning.forEach(r => console.log('  -', r));
    }
    
    // Clean up test token
    console.log('\nCleaning up test token...');
    await db('tokens').where('address', testToken.address).delete();
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

testBuySignal();