import { DexScreenerClient } from '../src/api/dexscreener-client';
import { BirdeyeClient } from '../src/api/birdeye-client';
import { RaydiumClient } from '../src/api/raydium-client';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function debugLiquidity() {
  // Get a token that should have liquidity
  const token = await db('tokens')
    .where('category', 'AIM')
    .orWhere('category', 'HIGH')
    .orderBy('market_cap', 'desc')
    .first();

  if (!token) {
    console.log('No HIGH/AIM tokens found');
    return;
  }

  console.log(`\nDebugging liquidity for: ${token.symbol} (${token.address})`);
  console.log(`Current DB values - MC: $${token.market_cap}, Liq: $${token.liquidity}`);

  // Initialize clients
  const dexscreener = new DexScreenerClient();
  const birdeye = new BirdeyeClient(config.apis.birdeyeApiKey);
  const raydium = new RaydiumClient();

  // Test DexScreener
  console.log('\n=== DexScreener ===');
  try {
    const dexData = await dexscreener.getTokenPairs(token.address);
    if (dexData && dexData.length > 0) {
      const pair = dexData[0];
      console.log('Raw pair data:', JSON.stringify(pair, null, 2));
      console.log(`Liquidity: ${pair.liquidity}`);
      console.log(`FDV: ${pair.fdv}`);
      console.log(`Volume24h: ${pair.volume24h}`);
    } else {
      console.log('No pairs found');
    }
  } catch (error) {
    console.error('DexScreener error:', error);
  }

  // Test Birdeye
  console.log('\n=== Birdeye ===');
  try {
    const birdData = await birdeye.getTokenOverview(token.address);
    console.log('Birdeye response:', JSON.stringify(birdData, null, 2));
  } catch (error) {
    console.error('Birdeye error:', error);
  }

  // Test Raydium
  console.log('\n=== Raydium ===');
  try {
    const rayData = await raydium.getPoolInfo(token.address);
    console.log('Raydium response:', JSON.stringify(rayData, null, 2));
  } catch (error) {
    console.error('Raydium error:', error);
  }

  // Check recent similar tokens
  console.log('\n=== Recent tokens with liquidity ===');
  const tokensWithLiquidity = await db('tokens')
    .where('liquidity', '>', 0)
    .orderBy('updated_at', 'desc')
    .limit(5)
    .select('symbol', 'liquidity', 'market_cap', 'updated_at');

  console.table(tokensWithLiquidity);
}

debugLiquidity()
  .then(() => process.exit(0))
  .catch(console.error);