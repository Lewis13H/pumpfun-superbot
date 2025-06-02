// Save as: scripts/test-market-updates.ts
import { db } from '../src/database/postgres';
import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { scanScheduler } from '../src/category/scan-scheduler';
import { logger } from '../src/utils/logger';

async function testMarketDataUpdates() {
  console.log('=== Testing Market Data Updates ===\n');

  // Step 1: Get a LOW category token
  const lowToken = await db('tokens')
    .where('category', 'LOW')
    .whereNotNull('market_cap')
    .orderBy('discovered_at', 'desc')
    .first();

  if (!lowToken) {
    console.log('❌ No LOW category tokens found');
    return;
  }

  console.log(`Testing with token: ${lowToken.symbol} (${lowToken.address})`);
  console.log(`Current market_cap: $${lowToken.market_cap}`);
  console.log(`Current liquidity: $${lowToken.liquidity}`);
  console.log(`Last updated: ${lowToken.updated_at}\n`);

  // Step 2: Test API analysis directly
  console.log('Testing API analysis...');
  try {
    const result = await categoryAPIRouter.analyzeToken(
      lowToken.address,
      'LOW',
      false
    );
    
    console.log('API Result:');
    console.log(`  Market Cap: $${result.marketCap}`);
    console.log(`  Liquidity: $${result.liquidity}`);
    console.log(`  APIs Used: ${result.apisUsed.join(', ')}`);
    console.log(`  Analysis Type: ${result.analysisType}\n`);
  } catch (error) {
    console.error('❌ API analysis failed:', error);
  }

  // Step 3: Check if data was updated
  const updatedToken = await db('tokens')
    .where('address', lowToken.address)
    .first();

  console.log('Database after analysis:');
  console.log(`  Market Cap: $${updatedToken.market_cap} (was: $${lowToken.market_cap})`);
  console.log(`  Liquidity: $${updatedToken.liquidity} (was: $${lowToken.liquidity})`);
  console.log(`  Updated: ${updatedToken.updated_at}\n`);

  // Step 4: Check scan scheduler status
  const scanStats = scanScheduler.getStats();
  console.log('Scan Scheduler Status:');
  console.log(`  LOW category tasks: ${scanStats.LOW?.totalTasks || 0}`);
  console.log(`  LOW active scans: ${scanStats.LOW?.activeScans || 0}`);
  console.log(`  LOW completed: ${scanStats.LOW?.completedScans || 0}\n`);

  // Step 5: Force a manual update to test DB connection
  console.log('Testing manual DB update...');
  const testUpdate = await db('tokens')
    .where('address', lowToken.address)
    .update({
      market_cap: 99999,
      liquidity: 88888,
      updated_at: new Date()
    });

  console.log(`Manual update affected ${testUpdate} rows`);

  const manualCheck = await db('tokens')
    .where('address', lowToken.address)
    .select('market_cap', 'liquidity')
    .first();

  console.log(`After manual update - MC: $${manualCheck.market_cap}, Liq: $${manualCheck.liquidity}`);
}

// Run test
testMarketDataUpdates()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });