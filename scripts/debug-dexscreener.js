// scripts/debug-dexscreener.js
const axios = require('axios');

async function debugDexScreener() {
  const tokenAddress = 'BML7jTJWfLMJkbBXY5mreG4eWnVrLuFLXp2qVoRxpump'; // DWCWRWBWH
  
  try {
    console.log('Fetching DexScreener data for:', tokenAddress);
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: 10000 }
    );
    
    if (response.data.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      console.log('\n📊 Raw pair data:');
      console.log(JSON.stringify(pair, null, 2));
      
      console.log('\n🔍 Extracted values:');
      console.log('Market Cap (fdv):', pair.fdv);
      console.log('Liquidity object:', pair.liquidity);
      console.log('Liquidity USD:', pair.liquidity?.usd);
      console.log('Volume object:', pair.volume);
      console.log('Volume 24h:', pair.volume?.h24);
      console.log('Price USD:', pair.priceUsd);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugDexScreener();