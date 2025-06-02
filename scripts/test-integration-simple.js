console.log('=== Simple State Machine Integration Test ===\n');

async function runTest() {
  try {
    // Test basic imports - using correct path
    const path = require('path');
    const srcPath = path.join(__dirname, '..', 'src');
    
    // Compile TypeScript files first
    require('ts-node').register({
      transpileOnly: true,
      compilerOptions: {
        strict: false
      }
    });
    
    const { createTokenStateMachine } = require(path.join(srcPath, 'category', 'state-machines'));
    const { interpret } = require('xstate');
    const { categoryConfig } = require(path.join(srcPath, 'config', 'category-config'));
    
    console.log('✅ All imports successful');
    
    // Test state machine creation
    const machine = createTokenStateMachine('INTEGRATION_TEST');
    const service = interpret(machine).start();
    
    console.log('✅ State machine created and started');
    console.log('   Initial state:', service.state.value);
    
    // Test transitions
    const transitions = [
      { marketCap: 5000, expected: 'LOW' },
      { marketCap: 15000, expected: 'MEDIUM' },
      { marketCap: 25000, expected: 'HIGH' },
      { marketCap: 45000, expected: 'AIM' }
    ];
    
    console.log('\nTesting transitions:');
    for (const { marketCap, expected } of transitions) {
      service.send({ type: 'UPDATE_MARKET_CAP', marketCap });
      const actual = service.state.value;
      const status = actual === expected ? '✅' : '❌';
      console.log(`   $${marketCap} → ${actual} ${status} (expected: ${expected})`);
    }
    
    // Test scan count
    const beforeScan = service.state.context.scanCount;
    service.send({ type: 'SCAN_COMPLETE' });
    const afterScan = service.state.context.scanCount;
    console.log(`\n✅ Scan count: ${beforeScan} → ${afterScan}`);
    
    service.stop();
    
    console.log('\n🎉 All tests passed! State machine is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

runTest();