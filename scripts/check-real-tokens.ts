import { db } from '../src/database/postgres';
import { apiManager } from '../src/integrations/api-manager';
import { PublicKey } from '@solana/web3.js';

async function checkRealTokens() {
  console.log('\n🎯 Checking for Real Tokens on DEXes\n');

  // Strategy: Get tokens that were marked as COMPLETED but have no price
  const analyzedTokens = await db('tokens')
    .select('address', 'symbol', 'name', 'platform', 'created_at', 'analysis_status')
    .where('analysis_status', 'COMPLETED')
    .where(function() {
      this.where('price', 0).orWhereNull('price');
    })
    .orderBy('created_at', 'asc') // Oldest first
    .limit(20);

  console.log(`Found ${analyzedTokens.length} analyzed tokens without price data\n`);

  let validAddresses = 0;
  let foundOnDex = 0;
  const successfulTokens = [];

  for (const token of analyzedTokens) {
    // First validate the address
    let isValid = false;
    try {
      new PublicKey(token.address);
      isValid = true;
      validAddresses++;
    } catch (error) {
      console.log(`❌ Invalid address: ${token.symbol} - ${token.address.slice(0, 20)}...`);
      continue;
    }

    if (isValid) {
      console.log(`\n🔍 Checking ${token.symbol || token.address.slice(0, 8)}...`);
      
      try {
        // Use DexScreener only (more lenient with addresses)
        const dexClient = (apiManager as any).clients.get('dexscreener');
        const data = await dexClient.getTokenData(token.address);
        
        if (data && data.price > 0) {
          foundOnDex++;
          successfulTokens.push({
            ...token,
            price: data.price,
            liquidity: data.liquidity,
            volume24h: data.volume24h,
            symbol: data.symbol,
            name: data.name
          });
          
          console.log(`  ✅ Found on DEX!`);
          console.log(`  💰 Price: $${data.price.toFixed(8)}`);
          console.log(`  💧 Liquidity: $${data.liquidity.toLocaleString()}`);
        } else {
          console.log(`  ⏳ Not on DEX yet`);
        }
      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`);
      }
      
      // Be nice to APIs
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log('\n📊 Summary:');
  console.log(`  Valid addresses: ${validAddresses}/${analyzedTokens.length}`);
  console.log(`  Found on DEXes: ${foundOnDex}`);

  if (successfulTokens.length > 0) {
    console.log('\n🏆 Tokens Found on DEXes:');
    
    // Sort by liquidity
    successfulTokens.sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
    
    for (const token of successfulTokens) {
      console.log(`\n${token.symbol} (${token.name})`);
      console.log(`  💰 Price: $${token.price.toFixed(8)}`);
      console.log(`  💧 Liquidity: $${token.liquidity.toLocaleString()}`);
      console.log(`  📊 24h Volume: $${token.volume24h.toLocaleString()}`);
      console.log(`  📍 Address: ${token.address}`);
    }

    // Mark for re-analysis
    const addresses = successfulTokens.map(t => t.address);
    await db('tokens')
      .whereIn('address', addresses)
      .update({
        analysis_status: 'PENDING',
        updated_at: new Date()
      });

    console.log(`\n✅ Marked ${successfulTokens.length} tokens for re-analysis`);
  }

  // Also check some known good memecoins
  console.log('\n🧪 Testing Known Memecoins:');
  const knownMemecoins = [
    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK' },
    { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT' },
    { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF' },
    { address: 'AVLhahDcDQ4m4vHM4ug63oh7xc8Jtk49Dm5hoe9Sazqr', symbol: 'MYRO' }
  ];

  for (const known of knownMemecoins.slice(0, 2)) {
    try {
      const data = await apiManager.getTokenData(known.address);
      if (data) {
        console.log(`✅ ${known.symbol}: $${data.price.toFixed(8)}`);
      }
    } catch (error) {
      console.log(`❌ ${known.symbol}: Failed to fetch`);
    }
  }

  console.log('\n✅ Check complete!\n');
}

checkRealTokens()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Check failed:', error);
    process.exit(1);
  });