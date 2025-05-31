import { SmartTokenFilter } from '../src/discovery/smart-token-filter';

const filter = new SmartTokenFilter();
const filters = filter.getFilters();

console.log('Available filters:');
filters.forEach((config: any, name: string) => {
  console.log(`\n${name}:`);
  console.log(`  Min Market Cap: $${config.minMarketCap}`);
  console.log(`  Min Liquidity: $${config.minLiquidity}`);
  console.log(`  Min Holders: ${config.minHolders}`);
  
  // Check for optional properties
  if ('minAge' in config) {
    console.log(`  Min Age: ${config.minAge} seconds`);
  }
  if ('requireDexScreener' in config) {
    console.log(`  Require DexScreener: ${config.requireDexScreener}`);
  }
  
  // Show all properties
  console.log('  All properties:', Object.keys(config));
});
