import { discoveryService } from '../src/discovery/discovery-service';
import { TokenDiscovery } from '../src/discovery/base-monitor';
import { logger } from '../src/utils/logger';

async function testTokenDiscovery() {
  logger.info('Testing token discovery pipeline...');

  // Create a mock token discovery event
  const mockToken: TokenDiscovery = {
    address: 'TestToken' + Date.now() + '111111111111111111111',
    symbol: 'TEST',
    name: 'Test Token ' + Date.now(),
    platform: 'test',
    createdAt: new Date(),
    metadata: {
      test: true,
      marketCap: 50000,
    },
  };

  // Get discovery manager from service
  const discoveryManager = (discoveryService as any).discoveryManager;
  
  // Emit a test token discovery
  discoveryManager.emit('tokenDiscovered', mockToken);

  logger.info('Test token emitted, check logs for processing...');
  
  // Wait a bit to see processing
  setTimeout(() => {
    logger.info('Test complete');
    process.exit(0);
  }, 5000);
}

// Initialize and run test
discoveryService.initialize().then(() => {
  testTokenDiscovery();
});