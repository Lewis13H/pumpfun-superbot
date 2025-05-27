import { apiManager } from '../src/integrations/api-manager';
import { logger } from '../src/utils/logger';

async function testAPIIntegration() {
  logger.info('Testing API Integration...');

  // Test with a known token (Wrapped SOL)
  const testTokens = [
    {
      address: 'So11111111111111111111111111111111111111112',
      name: 'Wrapped SOL'
    },
    {
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USD Coin'
    }
  ];

  for (const testToken of testTokens) {
    logger.info(`\n=== Testing ${testToken.name} ===`);
    
    try {
      // Test token data
      logger.info('Fetching token data...');
      const tokenData = await apiManager.getTokenData(testToken.address);
      if (tokenData) {
        logger.info('Token Data:', {
          symbol: tokenData.symbol,
          name: tokenData.name,
          price: tokenData.price,
          marketCap: tokenData.marketCap,
          volume24h: tokenData.volume24h,
          liquidity: tokenData.liquidity,
          holders: tokenData.holders
        });
      } else {
        logger.warn('No token data returned');
      }

      // Test market data
      logger.info('\nFetching market data...');
      try {
        const marketData = await apiManager.getMarketData(testToken.address);
        if (marketData) {
          logger.info('Market Data:', {
            price: marketData.price,
            volume24h: marketData.volume24h,
            priceChange24h: marketData.priceChange24h,
            high24h: marketData.high24h,
            low24h: marketData.low24h
          });
        }
      } catch (error: any) {
        logger.warn('Market data failed:', error.message);
      }

      // Test liquidity data
      logger.info('\nFetching liquidity data...');
      try {
        const liquidityData = await apiManager.getLiquidityData(testToken.address);
        if (liquidityData) {
          logger.info('Liquidity Data:', {
            totalLiquidityUSD: liquidityData.totalLiquidityUSD,
            poolCount: liquidityData.poolCount,
            mainPool: liquidityData.mainPool?.dex
          });
        }
      } catch (error: any) {
        logger.warn('Liquidity data failed:', error.message);
      }

      // Test holder data (may not be available for all tokens)
      logger.info('\nFetching holder data...');
      try {
        const holderData = await apiManager.getHolderData(testToken.address);
        if (holderData) {
          logger.info('Holder Data:', {
            totalHolders: holderData.totalHolders,
            top10Percentage: holderData.top10Percentage,
            concentration: holderData.concentration
          });
        } else {
          logger.info('No holder data available');
        }
      } catch (error: any) {
        logger.warn('Holder data failed:', error.message);
      }

      // Test security data
      logger.info('\nFetching security data...');
      try {
        const securityData = await apiManager.getSecurityData(testToken.address);
        if (securityData) {
          logger.info('Security Data:', {
            rugPullRisk: securityData.rugPullRisk,
            mintable: securityData.mintable,
            freezable: securityData.freezable,
            topHolderConcentration: securityData.topHolderConcentration
          });
        }
      } catch (error: any) {
        logger.warn('Security data failed:', error.message);
      }

    } catch (error) {
      logger.error(`Error testing ${testToken.name}:`, error);
    }
  }

  // Test with a newly discovered token (get from database)
  logger.info('\n=== Testing Recently Discovered Token ===');
  try {
    const { db } = require('../src/database/postgres');
    const recentToken = await db('tokens')
      .select('address', 'symbol', 'name')
      .where('platform', 'pumpfun')
      .orderBy('discovered_at', 'desc')
      .first();

    if (recentToken) {
      logger.info(`Testing ${recentToken.symbol} (${recentToken.address})`);
      
      const tokenData = await apiManager.getTokenData(recentToken.address);
      if (tokenData) {
        logger.info('Token found on APIs:', {
          symbol: tokenData.symbol,
          name: tokenData.name,
          price: tokenData.price,
          marketCap: tokenData.marketCap,
          liquidity: tokenData.liquidity
        });
      } else {
        logger.info('Token not yet listed on APIs (too new)');
      }
    }
  } catch (error) {
    logger.error('Error testing recent token:', error);
  }

  // Show API status
  logger.info('\n=== API Status ===');
  const status = apiManager.getStatus();
  logger.info('API Client Status:', status);
}

// Run the test
testAPIIntegration()
  .then(() => {
    logger.info('\nAPI Integration test completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed:', error);
    process.exit(1);
  });