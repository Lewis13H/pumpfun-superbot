import { scanScheduler } from '../src/category/scan-scheduler';
import { tokenEnrichmentService } from '../src/analysis/token-enrichment-service';
import { db } from '../src/database/postgres';

async function testScanScheduler() {
  console.log('=== Testing Scan Scheduler ===\n');
  
  // 1. Check if enrichment service is running
  console.log('1. Checking Token Enrichment Service:');
  const enrichmentStats = await tokenEnrichmentService.getStats();
  console.log(`   Is Running: ${enrichmentStats.isRunning}`);
  console.log(`   Stale Tokens: ${enrichmentStats.staleTokens}`);
  
  // 2. Start the enrichment service if not running
  if (!enrichmentStats.isRunning) {
    console.log('\n2. Starting Token Enrichment Service...');
    await tokenEnrichmentService.start();
    console.log('   ✅ Started');
  }
  
  // 3. Get a sample token and try to schedule it
  console.log('\n3. Testing manual token scheduling:');
  const sampleToken = await db('tokens')
    .where('category', 'LOW')
    .whereNotNull('address')
    .first();
  
  if (sampleToken) {
    console.log(`   Scheduling ${sampleToken.symbol} (${sampleToken.address})`);
    
    try {
      await scanScheduler.scheduleToken(
        sampleToken.address,
        sampleToken.category,
        sampleToken.category_scan_count || 0
      );
      console.log('   ✅ Scheduled successfully');
    } catch (error) {
      console.log('   ❌ Scheduling failed:', error);
    }
  }
  
  // 4. Check stats after scheduling
  console.log('\n4. Scan Scheduler Stats After:');
  const stats = scanScheduler.getStats();
  Object.entries(stats).forEach(([category, data]: [string, any]) => {
    if (data.totalTasks > 0) {
      console.log(`   ${category}: ${data.totalTasks} tasks`);
    }
  });
  
  // 5. Check if handlers are registered
  console.log('\n5. Checking registered handlers:');
  // This is a bit hacky but we need to check
  const handlers = (scanScheduler as any).scanHandlers;
  if (handlers && handlers.size) {
    console.log(`   Registered handlers: ${handlers.size}`);
    handlers.forEach((handler: any, category: string) => {
      console.log(`   - ${category}: ${handler ? '✅' : '❌'}`);
    });
  } else {
    console.log('   ❌ No handlers registered!');
  }
}

testScanScheduler()
  .then(() => {
    console.log('\nTest complete. Press Ctrl+C to exit.');
    // Keep process alive to see if scans happen
    setInterval(() => {
      const stats = scanScheduler.getStats();
      let total = 0;
      Object.values(stats).forEach((s: any) => {
        total += s.totalTasks || 0;
      });
      console.log(`Active tasks: ${total}`);
    }, 5000);
  })
  .catch(console.error);