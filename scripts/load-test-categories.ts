import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import { db } from '../src/database/postgres';

async function loadTest() {
  console.log('=== Category System Load Test ===\n');
  
  const tokenCount = 1000;
  const testTokens: any[] = [];
  
  // Create test tokens
  console.log(`Creating ${tokenCount} test tokens...`);
  
  for (let i = 0; i < tokenCount; i++) {
    const marketCap = Math.random() * 100000;
    const category = 
      marketCap < 8000 ? 'LOW' :
      marketCap < 19000 ? 'MEDIUM' :
      marketCap < 35000 ? 'HIGH' :
      marketCap < 105000 ? 'AIM' : 'AIM';
    
    testTokens.push({
      address: `LOAD_TEST_${i}`,
      symbol: `TEST${i}`,
      name: `Load Test Token ${i}`,
      category,
      market_cap: marketCap,
      liquidity: marketCap * 0.3,
      volume_24h: marketCap * 0.1,
      platform: 'test',
      created_at: new Date(),
      discovered_at: new Date(),
    });
  }
  
  // Insert in batches
  const batchSize = 100;
  for (let i = 0; i < testTokens.length; i += batchSize) {
    const batch = testTokens.slice(i, i + batchSize);
    await db('tokens').insert(batch).onConflict('address').merge();
    console.log(`Inserted ${i + batch.length}/${tokenCount} tokens`);
  }
  
  // Create state machines
  console.log('\nCreating state machines...');
  const startTime = Date.now();
  
  for (const token of testTokens) {
    await categoryManager.createOrRestoreStateMachine(
      token.address,
      token.category,
      { currentMarketCap: token.market_cap }
    );
  }
  
  const machineTime = Date.now() - startTime;
  console.log(`Created ${tokenCount} state machines in ${machineTime}ms (${(machineTime / tokenCount).toFixed(2)}ms per token)`);
  
  // Schedule scans
  console.log('\nScheduling scans...');
  const scheduleStart = Date.now();
  
  for (const token of testTokens) {
    await scanScheduler.scheduleToken(token.address, token.category);
  }
  
  const scheduleTime = Date.now() - scheduleStart;
  console.log(`Scheduled ${tokenCount} tokens in ${scheduleTime}ms`);
  
  // Simulate market cap changes
  console.log('\nSimulating market cap changes...');
  const changeStart = Date.now();
  let transitions = 0;
  
  for (let i = 0; i < 100; i++) {
    const token = testTokens[Math.floor(Math.random() * testTokens.length)];
    const newMarketCap = Math.random() * 100000;
    
    await categoryManager.updateTokenMarketCap(token.address, newMarketCap);
    transitions++;
  }
  
  const changeTime = Date.now() - changeStart;
  console.log(`Processed ${transitions} market cap changes in ${changeTime}ms`);
  
  // Check performance
  console.log('\nPerformance Summary:');
  console.log(`  State Machines: ${categoryManager.getStats().activeMachines}`);
  
  const scanStats = scanScheduler.getStats();
  let totalTasks = 0;
  Object.values(scanStats).forEach((s: any) => {
    totalTasks += s.totalTasks || 0;
  });
  console.log(`  Scheduled Tasks: ${totalTasks}`);
  
  // Memory usage
  const memUsage = process.memoryUsage();
  console.log(`  Memory Usage:`);
  console.log(`    Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`    RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  
  // Clean up
  console.log('\nCleaning up test data...');
  await db('tokens').whereIn('address', testTokens.map(t => t.address)).delete();
  await categoryManager.cleanup();
  
  console.log('✅ Load test completed');
}

loadTest()
  .then(() => process.exit(0))
  .catch(console.error);
