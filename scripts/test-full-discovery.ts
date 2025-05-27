import { EventEmitter } from 'events';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

class TestMonitor extends EventEmitter {
  emitTestToken() {
    const token = {
      address: 'TestToken' + Date.now() + '111111111111111111111',
      symbol: 'TEST',
      name: 'Test Token ' + Date.now(),
      platform: 'pumpfun',
      createdAt: new Date(),
      metadata: {
        test: true,
        marketCap: 50000,
      },
    };
    
    logger.info('Emitting test token discovery...');
    this.emit('tokenDiscovered', token);
  }
}

async function testFullDiscovery() {
  // Import the running discovery service
  const { discoveryService } = require('../src/discovery/discovery-service');
  
  // Create and register test monitor
  const testMonitor = new TestMonitor();
  (discoveryService as any).discoveryManager.registerMonitor(testMonitor);
  
  // Emit test token
  testMonitor.emitTestToken();
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check database
  const result = await db('tokens')
    .select('symbol', 'name', 'platform')
    .orderBy('discovered_at', 'desc')
    .limit(1)
    .first();
    
  if (result) {
    logger.info('Test token found in database:', result);
  } else {
    logger.info('No test token found in database');
  }
  
  process.exit(0);
}

testFullDiscovery().catch(console.error);