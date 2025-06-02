import { FilteredDiscoveryManager } from '../src/discovery/filtered-discovery-manager';
import { db } from '../src/database/postgres';

async function testDiscoveryUnit() {
  console.log('=== Discovery Manager Unit Test ===\n');
  
  const manager = new FilteredDiscoveryManager();
  await manager.initialize();
  
  // Check stats initialization
  const stats = manager.getStats();
  console.log('Initial Stats:', stats);
  
  // Create a mock token discovery
  const mockToken = {
    address: 'TEST_' + Date.now(),
    symbol: 'TEST',
    name: 'Test Token',
    platform: 'pumpfun' as const,
    createdAt: new Date(),
    metadata: {
      vSolInBondingCurve: 10,
      vTokensInBondingCurve: 1000000,
    }
  };
  
  // Manually trigger token discovery
  console.log('\nTesting token discovery...');
  await (manager as any).handleTokenDiscovery(mockToken);
  
  // Check if token was saved
  const savedToken = await db('tokens')
    .where('address', mockToken.address)
    .first();
  
  console.log('\nToken saved:', savedToken ? 'YES' : 'NO');
  if (savedToken) {
    console.log('  Category:', savedToken.category);
    console.log('  Market Cap:', savedToken.market_cap);
  }
  
  // Check updated stats
  const newStats = manager.getStats();
  console.log('\nUpdated Stats:', newStats);
  
  // Cleanup
  await db('tokens').where('address', mockToken.address).delete();
  
  process.exit(0);
}

testDiscoveryUnit().catch(console.error);