import { discoveryService } from '../src/discovery/discovery-service';
import { tokenEnrichmentService } from '../src/analysis/token-enrichment-service';
import { categoryManager } from '../src/category/category-manager';
import { db } from '../src/database/postgres';

async function testEnrichment() {
  console.log('Starting enrichment test...');
  
  // Initialize services
  await discoveryService.initialize();
  
  // Test with different categories
  const testTokens = [
    { address: 'LOW_TEST', symbol: 'LOWT', marketCap: 5000, category: 'LOW' },
    { address: 'MED_TEST', symbol: 'MEDT', marketCap: 15000, category: 'MEDIUM' },
    { address: 'HIGH_TEST', symbol: 'HIGHT', marketCap: 25000, category: 'HIGH' },
    { address: 'AIM_TEST', symbol: 'AIMT', marketCap: 45000, category: 'AIM' },
  ];
  
  // Insert test tokens
  for (const token of testTokens) {
    await db('tokens').insert({
      ...token,
      name: `Test ${token.symbol}`,
      platform: 'test',
      liquidity: token.marketCap * 0.3,
      created_at: new Date(),
      discovered_at: new Date(),
    }).onConflict('address').merge();
    
    // Create state machine
    await categoryManager.createOrRestoreStateMachine(
      token.address,
      token.category as any
    );
  }
  
  console.log('Test tokens created, waiting for enrichment...');
  
  // Monitor enrichment
  tokenEnrichmentService.on('tokenEnriched', (data) => {
    console.log(`\nEnriched: ${data.address}`);
    console.log(`  Category: ${data.category}`);
    console.log(`  Analysis Type: ${data.analysisType}`);
    console.log(`  Market Cap: ${data.marketCap}`);
  });
  
  // Run for 2 minutes
  setTimeout(async () => {
    console.log('\nTest complete!');
    
    // Show final state
    const finalTokens = await db('tokens')
      .whereIn('address', testTokens.map(t => t.address))
      .select('symbol', 'category', 'market_cap', 'updated_at', 'category_scan_count');
    
    console.log('\nFinal Token States:');
    console.table(finalTokens);
    
    process.exit(0);
  }, 120000);
}

testEnrichment().catch(console.error);

