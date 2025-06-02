import { categoryManager } from '../src/category/category-manager';
import { db } from '../src/database/postgres';

console.log('=== Testing CategoryManager ===\n');

async function testCategoryManager() {
  try {
    // Test 1: Create a test token
    console.log('1. Creating test token in database...');
    const testAddress = 'CAT_TEST_' + Date.now();
    
    await db('tokens').insert({
      address: testAddress,
      symbol: 'CATTEST',
      name: 'Category Manager Test',
      category: 'NEW',
      market_cap: 1000,
      liquidity: 500,
      created_at: new Date(),
      discovered_at: new Date(),
    }).onConflict('address').ignore();
    
    console.log('   Token created:', testAddress);
    
    // Test 2: Create state machine
    console.log('\n2. Creating state machine via CategoryManager...');
    await categoryManager.createOrRestoreStateMachine(testAddress, 'NEW', {
      currentMarketCap: 1000,
      scanCount: 0
    });
    
    // Test 3: Update market cap
    console.log('\n3. Testing market cap updates...');
    
    // Update to trigger transition to AIM
    await categoryManager.updateTokenMarketCap(testAddress, 50000);
    
    // Get the current state
    const state = categoryManager.getTokenState(testAddress);
    console.log('   State after $50,000 update:', state?.value);
    
    // Test 4: Get statistics
    console.log('\n4. Getting CategoryManager stats...');
    const stats = categoryManager.getStats();
    console.log('   Active machines:', stats.activeMachines);
    console.log('   Cached states:', stats.cachedStates);
    
    // Test 5: Get category distribution
    console.log('\n5. Getting category distribution...');
    const distribution = await categoryManager.getCategoryDistribution();
    console.log('   Distribution:', distribution);
    
    // Clean up
    console.log('\n6. Cleaning up...');
    await db('tokens').where('address', testAddress).delete();
    await db('category_transitions').where('token_address', testAddress).delete();
    
    console.log('\n✅ CategoryManager tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
  } finally {
    // Ensure cleanup
    await db.destroy();
    process.exit(0);
  }
}

testCategoryManager();
