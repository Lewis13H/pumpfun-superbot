import { getCategoryFromMarketCap, getValidTransitions } from '../src/config/category-utils';
import { TokenCategory } from '../src/config/category-config';

console.log('=== Edge Case Tests ===\n');

// Test boundary values
console.log('1. Boundary value tests:');
const boundaries = [0, 7999, 8000, 8001, 18999, 19000, 19001, 34999, 35000, 35001, 104999, 105000, 105001];
boundaries.forEach(mc => {
  console.log(`   $${mc} → ${getCategoryFromMarketCap(mc)}`);
});

// Test valid transitions
console.log('\n2. Valid transitions:');
const categories: TokenCategory[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'];
categories.forEach(cat => {
  const transitions = getValidTransitions(cat, 25000);
  console.log(`   ${cat} → [${transitions.join(', ')}]`);
});

console.log('\n✅ Edge case tests complete!');
