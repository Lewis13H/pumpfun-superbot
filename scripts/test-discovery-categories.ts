import { discoveryService } from '../src/discovery/discovery-service';
import { categoryManager } from '../src/category/category-manager';
import { db } from '../src/database/postgres';

async function testDiscovery() {
  console.log('Starting discovery test...');
  
  // Initialize and start discovery
  await discoveryService.initialize();
  await discoveryService.start();
  
  // Monitor for 2 minutes
  const startTime = Date.now();
  const duration = 120000; // 2 minutes
  
  const interval = setInterval(async () => {
    const stats = discoveryService.getStats();
    const distribution = await categoryManager.getCategoryDistribution();
    
    console.clear();
    console.log('=== Discovery Test ===\n');
    console.log('Discovery Stats:');
    console.log(`  Total Discovered: ${stats.discovery.totalDiscovered}`);
    console.log(`  Saved Tokens: ${stats.discovery.savedTokens}`);
    console.log(`  Save Rate: ${stats.discovery.totalDiscovered > 0 ? ((stats.discovery.savedTokens / stats.discovery.totalDiscovered) * 100).toFixed(2) + '%' : '100%'}`);
    
    console.log('\nCategory Distribution:');
    Object.entries(distribution).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}`);
    });
    
    console.log('\nRecent Tokens:');
    const recentTokens = await db('tokens')
      .orderBy('discovered_at', 'desc')
      .limit(5)
      .select('symbol', 'category', 'market_cap');
    
    recentTokens.forEach(token => {
      console.log(`  ${token.symbol}: ${token.category} ($${token.market_cap})`);
    });
    
    if (Date.now() - startTime > duration) {
      clearInterval(interval);
      console.log('\nTest complete!');
      await discoveryService.stop();
      process.exit(0);
    }
  }, 5000);
}

testDiscovery().catch(console.error);
