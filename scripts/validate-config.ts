import { categoryConfig, validateConfig, ConfigManager } from '../src/config/category-config';
import { logger } from '../src/utils/logger';

console.log('Current Configuration:');
console.log(JSON.stringify(categoryConfig, null, 2));

console.log('\nValidating configuration...');
const isValid = validateConfig(categoryConfig);

if (isValid) {
  console.log('✅ Configuration is valid');
  
  // Test hot reload
  console.log('\nTesting hot reload...');
  ConfigManager.watch((config) => {
    console.log('Configuration updated:', config.thresholds);
  });
  
  // Simulate config change
  process.env.CATEGORY_LOW_MAX = '9000';
  const reloaded = ConfigManager.reload();
  console.log(`Hot reload ${reloaded ? 'successful' : 'failed'}`);
  
} else {
  console.log('❌ Configuration is invalid');
  process.exit(1);
}
