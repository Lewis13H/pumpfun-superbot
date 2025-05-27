import { apiManager } from '../src/integrations/api-manager';
import { logger } from '../src/utils/logger';
import { db } from '../src/database/postgres';

async function testAPISimple() {
  console.log('\n🔍 Testing API Integration\n');

  // Test 1: Known token (Bonk)
  console.log('1️⃣ Testing Known Token: BONK');
  try {
    const bonk = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    const tokenData = await apiManager.getTokenData(bonk);
    
    if (tokenData) {
      console.log(`   ✅ Found: ${tokenData.symbol} - ${tokenData.name}`);
      console.log(`   💰 Price: $${tokenData.price.toFixed(8)}`);
      console.log(`   📊 Market Cap: $${tokenData.marketCap.toLocaleString()}`);
      console.log(`   💧 24h Volume: $${tokenData.volume24h.toLocaleString()}`);
    } else {
      console.log('   ❌ No data found');
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 2: Recently discovered token
  console.log('\n2️⃣ Testing Recently Discovered Token');
  try {
    const recent = await db('tokens')
      .select('address', 'symbol', 'name')
      .where('platform', 'pumpfun')
      .whereNotNull('symbol')
      .orderBy('discovered_at', 'desc')
      .first();

    if (recent) {
      console.log(`   🆕 ${recent.symbol} (${recent.address.slice(0, 8)}...)`);
      
      const tokenData = await apiManager.getTokenData(recent.address);
      if (tokenData && tokenData.price > 0) {
        console.log(`   ✅ Found on DEX: ${tokenData.symbol}`);
        console.log(`   💰 Price: $${tokenData.price.toFixed(8)}`);
        console.log(`   📊 Market Cap: $${tokenData.marketCap.toLocaleString()}`);
        console.log(`   💧 Liquidity: $${tokenData.liquidity.toLocaleString()}`);
      } else {
        console.log('   ⏳ Not yet on DEX (too new)');
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 3: API Status
  console.log('\n3️⃣ API Status');
  const status = apiManager.getStatus();
  for (const api of status) {
    if (api.name !== 'cache') {
      const emoji = api.status === 'active' ? '✅' : '❌';
      console.log(`   ${emoji} ${api.name}: ${api.requestsInWindow} requests (${api.rateLimitRemaining} remaining)`);
    }
  }

  // Test 4: Check analyzed tokens
  console.log('\n4️⃣ Recently Analyzed Tokens');
  try {
    const analyzed = await db('tokens')
      .select('symbol', 'name', 'composite_score', 'investment_classification')
      .where('analysis_status', 'COMPLETED')
      .whereNotNull('composite_score')
      .orderBy('updated_at', 'desc')
      .limit(5);

    if (analyzed.length > 0) {
      for (const token of analyzed) {
        const score = (token.composite_score * 100).toFixed(1);
        const emoji = 
          token.investment_classification === 'STRONG_BUY' ? '🚀' :
          token.investment_classification === 'BUY' ? '📈' :
          token.investment_classification === 'CONSIDER' ? '🤔' :
          token.investment_classification === 'MONITOR' ? '👀' :
          token.investment_classification === 'HIGH_RISK' ? '⚠️' : '❌';
        
        console.log(`   ${emoji} ${token.symbol}: Score ${score}% - ${token.investment_classification}`);
      }
    } else {
      console.log('   ⏳ No analyzed tokens yet');
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n✅ Test Complete\n');
}

// Run the test
testAPISimple()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });