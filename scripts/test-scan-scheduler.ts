import { scanScheduler } from "../src/category/scan-scheduler";
import { categoryManager } from "../src/category/category-manager";
import { db } from "../src/database/postgres";
import { ScanTask, ScanResult } from "../src/category/scan-task.interface";

async function testScanScheduler() {
  console.log("Testing Scan Scheduler...\n");

  try {
    // Test 1: Initialize scheduler
    console.log("Test 1: Starting Scan Scheduler");
    await scanScheduler.start();
    console.log("✅ Scheduler started successfully");

    // Test 2: Schedule a test token
    console.log("\nTest 2: Scheduling a test token");
    const testToken = "TEST_SCHEDULER_123";
    await scanScheduler.scheduleToken(testToken, "HIGH", 0);
    console.log("✅ Token scheduled successfully");

    // Test 3: Get stats
    console.log("\nTest 3: Getting scheduler stats");
    const stats = scanScheduler.getStats();
    console.log("Stats:", JSON.stringify(stats, null, 2));

    // Test 4: Register a test handler
    console.log("\nTest 4: Registering scan handler");
    scanScheduler.registerScanHandler("HIGH", async (task: ScanTask): Promise<ScanResult> => {
      console.log(`Handler called for token: ${task.tokenAddress}`);
      return {
        tokenAddress: task.tokenAddress,
        success: true,
        marketCap: 25000,
        duration: 100,
        apisUsed: ["test"],
      };
    });
    console.log("✅ Handler registered");

    // Test 5: Handle category change
    console.log("\nTest 5: Testing category change");
    await scanScheduler.handleCategoryChange(testToken, "HIGH", "AIM");
    const updatedStats = scanScheduler.getStats();
    console.log("Updated stats:", JSON.stringify(updatedStats, null, 2));
    console.log("✅ Category change handled");

    // Clean up
    console.log("\nCleaning up test data...");
    await scanScheduler.stop();
    
    console.log("\n✅ All tests passed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    await db.destroy();
    process.exit(1);
  }
}

testScanScheduler();
