import { DexScreenerClient } from '../src/api/dexscreener-client';

async function testKnownToken() {
  const dexscreener = new DexScreenerClient();
  
  // Test with BONK - a known liquid token
  const bonkAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  
  console.log('Testing BONK token:', bonkAddress);
  const pairs = await dexscreener.getTokenPairs(bonkAddress);
  
  if (pairs && pairs.length > 0) {
    console.log('Found pairs:', pairs.length);
    console.log('First pair liquidity:', pairs[0].liquidity);
    console.log('First pair full data:', JSON.stringify(pairs[0], null, 2));
  }
}

testKnownToken().catch(console.error);
