// scripts/test-dexscreener.ts
import axios from 'axios';
import { logger } from '../src/utils/logger';

const BASE_URL = 'http://localhost:3000';

async function testDexScreener() {
  logger.info('Testing DexScreener integration...');

  // Test with a known token (Wrapped SOL)
  const testToken = 'So11111111111111111111111111111111111111112';

  try {
    // Test the API endpoint
    logger.info(`\nTesting with token: ${testToken}`);
    const response = await axios.get(`${BASE_URL}/api/integrations/test/${testToken}`);
    
    if (response.data.data) {
      const data = response.data.data;
      logger.info('\n✅ DexScreener data retrieved:');
      logger.info(`  Name: ${data.metadata.name}`);
      logger.info(`  Symbol: ${data.metadata.symbol}`);
      logger.info(`  Price: $${data.marketData.price.usd}`);
      logger.info(`  Market Cap: $${data.marketData.marketCap?.toLocaleString() || 0}`);
      logger.info(`  24h Volume: $${data.marketData.volume24h?.toLocaleString() || 0}`);
      logger.info(`  Liquidity: $${data.marketData.liquidity?.toLocaleString() || 0}`);
    }

    // Test API status
    const statusResponse = await axios.get(`${BASE_URL}/api/integrations/status`);
    logger.info('\n✅ API Status:', statusResponse.data);

    // Check if new tokens are getting real names
    logger.info('\n\nChecking recently discovered tokens...');
    const tokensResponse = await axios.get(`${BASE_URL}/tokens/list?limit=3`);
    
    logger.info('\nRecent tokens:');
    tokensResponse.data.tokens.forEach((token: any) => {
      logger.info(`  ${token.symbol} - ${token.name} (${token.investment_classification})`);
      logger.info(`    Price: $${token.price}`);
      logger.info(`    Liquidity: $${token.liquidity}`);
      logger.info(`    Score: ${token.composite_score}`);
      logger.info('');
    });

  } catch (error: any) {
    logger.error('Test failed:', {
      message: error.message,
      response: error.response?.data,
    });
  }

  process.exit(0);
}

// Wait for server to be ready
setTimeout(() => {
  testDexScreener();
}, 2000);