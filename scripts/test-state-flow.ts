import { createTokenStateMachine } from '../src/category/state-machines';
import { interpret } from 'xstate';
import { categoryConfig } from '../src/config/category-config';

console.log('=== Testing State Machine Complete Flow ===\n');

function testCompleteFlow() {
  // Test 1: Create machine
  console.log('1. Creating state machine...');
  const machine = createTokenStateMachine('FLOW_TEST');
  const service = interpret(machine);
  
  // Track state changes
  const stateHistory: string[] = [];
  
  service.onTransition((state) => {
    if (state.changed) {
      stateHistory.push(state.value as string);
      console.log(`   Transition to: ${state.value} (MC: $${state.context.currentMarketCap})`);
    }
  });
  
  service.start();
  
  // Test 2: Complete flow from NEW to AIM
  console.log('\n2. Testing complete flow NEW → LOW → MEDIUM → HIGH → AIM...');
  
  // Start with low market cap
  service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 100 });
  
  // Gradually increase
  const marketCaps = [5000, 12000, 22000, 40000];
  marketCaps.forEach(mc => {
    service.send({ type: 'UPDATE_MARKET_CAP', marketCap: mc });
  });
  
  console.log('\n3. State history:', stateHistory.join(' → '));
  
  // Test 3: Test scan limits
  console.log('\n4. Testing scan limits...');
  const currentState = service.state.value;
  const config = categoryConfig.scanIntervals[currentState as keyof typeof categoryConfig.scanIntervals];
  
  if (config) {
    console.log(`   Current state: ${currentState}`);
    console.log(`   Max scans: ${config.maxScans}`);
    console.log(`   Interval: ${config.interval}s`);
    console.log(`   Duration: ${config.duration}s`);
  }
  
  // Test 4: Reverse transition
  console.log('\n5. Testing reverse transition (market cap drop)...');
  service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 10000 });
  console.log(`   State after drop to $10,000: ${service.state.value}`);
  
  service.stop();
  
  console.log('\n✅ All flow tests completed!');
  console.log('\nConfiguration Summary:');
  console.log('  Market Cap Thresholds:');
  console.log(`    LOW: < $${categoryConfig.thresholds.LOW_MAX}`);
  console.log(`    MEDIUM: $${categoryConfig.thresholds.LOW_MAX} - $${categoryConfig.thresholds.MEDIUM_MAX}`);
  console.log(`    HIGH: $${categoryConfig.thresholds.MEDIUM_MAX} - $${categoryConfig.thresholds.HIGH_MAX}`);
  console.log(`    AIM: $${categoryConfig.thresholds.AIM_MIN} - $${categoryConfig.thresholds.AIM_MAX}`);
}

testCompleteFlow();