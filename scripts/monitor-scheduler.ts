import { scanScheduler } from '../src/category/scan-scheduler';
import { categoryManager } from '../src/category/category-manager';

async function monitorScheduler() {
  console.clear();
  console.log('=== Scan Scheduler Monitor ===\n');
  
  const stats = scanScheduler.getStats();
  const distribution = await categoryManager.getCategoryDistribution();
  
  // Display category distribution
  console.log('Token Distribution:');
  for (const [category, count] of Object.entries(distribution)) {
    console.log(`  ${category}: ${count} tokens`);
  }
  
  console.log('\nScheduler Status:');
  
  for (const [category, stat] of Object.entries(stats)) {
    console.log(`\n${category}:`);
    console.log(`  Total Tasks: ${stat.totalTasks}`);
    console.log(`  Active Scans: ${stat.activeScans}`);
    console.log(`  Completed: ${stat.completedScans}`);
    console.log(`  Failed: ${stat.failedScans}`);
    
    if (stat.nextScans.length > 0) {
      console.log('  Next Scans:');
      stat.nextScans.forEach((scan: any) => {
        const timeUntil = Math.round((scan.nextScan.getTime() - Date.now()) / 1000);
        console.log(`    ${scan.token.slice(0, 8)}... in ${timeUntil}s (scan #${scan.scanNumber})`);
      });
    }
  }
}

// Update every 5 seconds
setInterval(monitorScheduler, 5000);
monitorScheduler();
