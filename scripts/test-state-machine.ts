import { createTokenStateMachine } from '../src/category/state-machines';
import { categoryManager } from '../src/category/category-manager';
import { db } from '../src/database/postgres';
import { interpret } from 'xstate';

console.log('=== State Machine Test ===\n');

async function testStateMachine() {
  try {
    // Test 1: Create a state machine
    console.log('1. Creating state machine for test token...');
    const machine = createTokenStateMachine('TEST_TOKEN_123');
    const service = interpret(machine).start();
    
    console.log('   Initial state:', service.state.value);
    console.log('   ✅ State machine created successfully');
    
    // Test 2: Test transitions
    console.log('\n2. Testing state transitions...');
    
    // Transition to LOW
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 5000 });
    console.log('   After $5,000 update:', service.state.value);
    
    // Transition to MEDIUM
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 15000 });
    console.log('   After $15,000 update:', service.state.value);
    
    // Transition to HIGH
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 25000 });
    console.log('   After $25,000 update:', service.state.value);
    
    // Transition to AIM
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 45000 });
    console.log('   After $45,000 update:', service.state.value);
    
    // Test 3: Test scan counting
    console.log('\n3. Testing scan counting...');
    const currentScanCount = service.state.context.scanCount;
    service.send({ type: 'SCAN_COMPLETE' });
    console.log('   Scan count increased from', currentScanCount, 'to', service.state.context.scanCount);
    
    service.stop();
    
    // Test 4: Test CategoryManager
    console.log('\n4. Testing CategoryManager...');
    
    // Create a test token in the database
    const testAddress = 'CAT_MGR_TEST_' + Date.now();
    await db('tokens').insert({
      address: testAddress,
      symbol: 'CMTEST',
      name: 'Category Manager Test',
      category: 'NEW',
      market_cap: 1000,
      created_at: new Date(),
      discovered_at: new Date()
    }).onConflict('address').ignore();
    
    // Create state machine via CategoryManager
    await categoryManager.createOrRestoreStateMachine(testAddress, 'NEW', {
      currentMarketCap: 1000,
      scanCount: 0
    });
    
    // Update market cap
    await categoryManager.updateTokenMarketCap(testAddress, 50000);
    
    // Get state
    const state = categoryManager.getTokenState(testAddress);
    console.log('   Token state after $50,000 update:', state?.value);
    
    // Get stats
    const stats = categoryManager.getStats();
    console.log('   CategoryManager stats:', stats);
    
    // Clean up
    await db('tokens').where('address', testAddress).delete();
    
    console.log('\n✅ All state machine tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testStateMachine()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
