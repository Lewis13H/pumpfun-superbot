import { createTokenStateMachine, TokenContext, TokenEvent } from '../src/category/state-machines';
import { interpret } from 'xstate';

console.log('=== Testing State Machine ===\n');

// Test 1: Basic state machine creation
console.log('1. Creating state machine...');
const machine = createTokenStateMachine('TEST_TOKEN');
const service = interpret(machine).start();

console.log('   Initial state:', service.state.value);
console.log('   Initial context:', service.state.context);

// Test 2: Market cap transitions
console.log('\n2. Testing market cap transitions...');

// Update to LOW
service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 5000 } as TokenEvent);
console.log('   After $5,000:', service.state.value);

// Update to MEDIUM  
service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 15000 } as TokenEvent);
console.log('   After $15,000:', service.state.value);

// Update to HIGH
service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 25000 } as TokenEvent);
console.log('   After $25,000:', service.state.value);

// Update to AIM
service.send({ type: 'UPDATE_MARKET_CAP', marketCap: 45000 } as TokenEvent);
console.log('   After $45,000:', service.state.value);

// Test 3: Scan counting
console.log('\n3. Testing scan counting...');
const before = service.state.context.scanCount;
service.send({ type: 'SCAN_COMPLETE' } as TokenEvent);
const after = service.state.context.scanCount;
console.log(`   Scan count: ${before} -> ${after}`);

// Test 4: Force archive
console.log('\n4. Testing force archive...');
service.send({ type: 'FORCE_ARCHIVE', reason: 'test' } as TokenEvent);
console.log('   State after force archive:', service.state.value);

service.stop();
console.log('\n✅ All tests completed!');
