import { categoryConfig, validateConfig, ConfigManager } from '../src/config/category-config';
import { getCategoryFromMarketCap, getCategoryDisplayName, getCategoryColor } from '../src/config/category-utils';

console.log('=== Configuration Test ===\n');

// Test 1: Check configuration loaded
console.log('1. Configuration loaded:');
console.log('   Thresholds:', categoryConfig.thresholds);
console.log('   AIM range: $' + categoryConfig.thresholds.AIM_MIN + ' - $' + categoryConfig.thresholds.AIM_MAX);

// Test 2: Validate configuration
console.log('\n2. Configuration validation:');
const isValid = validateConfig(categoryConfig);
console.log('   Valid:', isValid);

// Test 3: Test scan intervals
console.log('\n3. Scan intervals:');
Object.entries(categoryConfig.scanIntervals).forEach(([cat, config]) => {
  if (config.interval > 0) {
    console.log(`   ${cat}: every ${config.interval}s for ${config.duration}s (max ${config.maxScans} scans)`);
  }
});

// Test 4: Test buy criteria
console.log('\n4. Buy signal criteria:');
console.log('   Market cap:', categoryConfig.buySignalCriteria.marketCap);
console.log('   Min liquidity: $' + categoryConfig.buySignalCriteria.liquidity.min);
console.log('   Min holders:', categoryConfig.buySignalCriteria.holders.min);
console.log('   SolSniffer blacklist:', categoryConfig.buySignalCriteria.solsniffer.blacklist);

// Test 5: Test utility functions
console.log('\n5. Utility functions:');
const testMarketCaps = [1000, 5000, 15000, 25000, 45000, 120000];
testMarketCaps.forEach(mc => {
  const category = getCategoryFromMarketCap(mc);
  console.log(`   $${mc} → ${category} (${getCategoryDisplayName(category)})`);
});

// Test 6: Test hot reload
console.log('\n6. Testing hot reload capability...');
ConfigManager.watch((config) => {
  console.log('   Config reloaded!');
});

console.log('\n✅ Configuration test complete!');
