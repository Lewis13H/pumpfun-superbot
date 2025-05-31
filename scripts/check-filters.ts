import { SmartTokenFilter } from '../src/discovery/smart-token-filter';

const filter = new SmartTokenFilter();
const filters = filter.getFilters();

console.log('Available filters:');
filters.forEach((config, name) => {
  console.log(`\n${name}:`);
  console.log(`  Min Market Cap: $${config.minMarketCap}`);
  console.log(`  Min Liquidity: $${config.minLiquidity}`);
  console.log(`  Min Holders: ${config.minHolders}`);
  console.log(`  Min Age: ${config.minAge} seconds`);
  console.log(`  Require DexScreener: ${config.requireDexScreener}`);
});
