// scripts/test-apis.ts
import axios from 'axios';
import { logger } from '../src/utils/logger';

const BASE_URL = 'http://localhost:3000';

// Test tokens (well-known Solana tokens)
const TEST_TOKENS = {
  WSOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

async function testAPIs() {
  logger.info('Testing API integrations...');

  try {
    // Test API status endpoint
    logger.info('\n1. Testing API status endpoint...');
    const statusResponse = await axios.get(`${BASE_URL}/api/integrations/status`);
    logger.info('API Status:', statusResponse.data);

    // Test comprehensive data for a known token
    logger.info('\n2. Testing comprehensive data for Wrapped SOL...');
    const comprehensiveResponse = await axios.get(
      `${BASE_URL}/api/integrations/comprehensive/${TEST_TOKENS.WSOL}`
    );
    
    if (comprehensiveResponse.data) {
      const data = comprehensiveResponse.data;
      logger.info('Token metadata:', {
        symbol: data.metadata.symbol,
        name: data.metadata.name,
        decimals: data.metadata.decimals,
      });
      logger.info('Market data:', {
        price: data.marketData.price.usd,
        marketCap: data.marketData.marketCap,
        volume24h: data.marketData.volume24h,
      });
      logger.info('Security data:', {
        verified: data.securityData.verified,
        rugPullRisk: data.securityData.rugPullRisk,
      });
      logger.info('Holder data:', {
        totalHolders: data.holderData.totalHolders,
        top10Percentage: data.holderData.top10Percentage,
      });
    }

    // Test individual endpoints
    logger.info('\n3. Testing individual endpoints for USDC...');
    
    const metadataResponse = await axios.get(
      `${BASE_URL}/api/integrations/metadata/${TEST_TOKENS.USDC}`
    );
    logger.info('USDC metadata:', metadataResponse.data);

    const marketResponse = await axios.get(
      `${BASE_URL}/api/integrations/market/${TEST_TOKENS.USDC}`
    );
    logger.info('USDC market data:', marketResponse.data);

    // Test the test endpoint
    logger.info('\n4. Running API test with BONK token...');
    const testResponse = await axios.post(`${BASE_URL}/api/integrations/test`, {
      address: TEST_TOKENS.BONK,
    });
    logger.info('API test results:', {
      success: testResponse.data.success,
      errors: testResponse.data.results.errors,
    });

    // Test token analysis
    logger.info('\n5. Testing token analysis queue...');
    const analyzeResponse = await axios.post(
      `${BASE_URL}/analysis/analyze/${TEST_TOKENS.BONK}`
    );
    logger.info('Analysis queued:', analyzeResponse.data);

    // Check analysis stats
    const analysisStatsResponse = await axios.get(`${BASE_URL}/analysis/stats`);
    logger.info('Analysis service stats:', analysisStatsResponse.data);

    logger.info('\n✅ All API tests completed successfully!');
    
  } catch (error: any) {
    logger.error('API test failed:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
  }

  process.exit(0);
}

// Add delay to ensure server is ready
setTimeout(() => {
  testAPIs();
}, 2000);