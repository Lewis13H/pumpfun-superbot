const { DatabaseService } = require('./build/database/database-service.js');
const { CategoryAPIRouter } = require('./build/analysis/category-api-router.js');

async function forceScan() {
  const tokenAddress = '7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump';
  const db = DatabaseService.getInstance();
  const router = new CategoryAPIRouter();
  
  console.log('Forcing scan of DuckStyle...');
  
  try {
    const result = await router.analyzeToken(tokenAddress, 'AIM');
    console.log('Scan complete:', {
      marketCap: result.marketCap,
      liquidity: result.liquidity,
      holders: result.holders
    });
  } catch (error) {
    console.error('Scan failed:', error.message);
  }
  
  process.exit(0);
}

forceScan();
