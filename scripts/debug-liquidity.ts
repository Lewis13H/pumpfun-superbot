import { DexScreenerClient } from '../src/api/dexscreener-client';
import { BirdeyeClient } from '../src/api/birdeye-client';
import { RaydiumClient } from '../src/api/raydium-client';
import { logger } from '../src/utils/logger';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function debugLiquidity() {
  // Test token from your database
  const testToken = '8Ejjia4XQJNM6K4UiQjSjtmLKJ9dGwxay91QLNULQ1q6'; // SIREN
  
  console.log(`\n=== Debugging Liquidity for ${testToken} ===\n`);
  
  // Initialize clients
  const dexscreener = new DexScreenerClient();
  const birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
  const raydium = new RaydiumClient();
  
  // Test DexScreener
  console.log('1. Testing DexScreener...');
  try {
    const dexData = await dexscreener.getTokenPairs(testToken);
    console.log('DexScreener Raw Response:', JSON.stringify(dexData, null, 2));
    
    if (dexData && dexData.length > 0) {
      const pair = dexData[0];
      console.log('DexScreener Parsed Data:', {
        liquidity: pair.liquidity,
        fdv: pair.fdv,
        volume24h: pair.volume24h,
        priceUsd: pair.priceUsd
      });
    } else {
      console.log('No pairs found on DexScreener');
    }
  } catch (error) {
    console.error('DexScreener Error:', error);
  }
  
  // Test Birdeye
  console.log('\n2. Testing Birdeye...');
  try {
    const birdeyeData = await birdeye.getTokenOverview(testToken);
    console.log('Birdeye Raw Response:', JSON.stringify(birdeyeData, null, 2));
  } catch (error) {
    console.error('Birdeye Error:', error);
  }
  
  // Test Raydium
  console.log('\n3. Testing Raydium...');
  try {
    const raydiumData = await raydium.getPoolInfo(testToken);
    console.log('Raydium Raw Response:', JSON.stringify(raydiumData, null, 2));
  } catch (error) {
    console.error('Raydium Error:', error);
  }
  
  // Check database
  console.log('\n4. Current Database Values:');
  const dbToken = await db('tokens')
    .where('address', testToken)
    .select('symbol', 'market_cap', 'liquidity', 'volume_24h', 'holders')
    .first();
  console.log('Database:', dbToken);
  
  // Check if token has any trading pairs
  console.log('\n5. Checking token pairs in database:');
  const pairs = await db('token_dex_pairs')
    .where('token_address', testToken)
    .select('*');
  console.log('Token pairs:', pairs);
  
  process.exit(0);
}

debugLiquidity().catch(console.error);
