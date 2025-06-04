import axios from 'axios';

async function checkDexScreener() {
  const tokenAddress = '7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump';
  const url = https://api.dexscreener.com/latest/dex/tokens/7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump;
  
  try {
    const response = await axios.get(url);
    const pairs = response.data.pairs || [];
    
    console.log('DexScreener Response:');
    pairs.forEach((pair, i) => {
      console.log(\nPair :);
      console.log('Market Cap:', pair.marketCap);
      console.log('FDV:', pair.fdv);
      console.log('Price USD:', pair.priceUsd);
      console.log('Liquidity:', pair.liquidity);
      console.log('DEX:', pair.dexId);
    });
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkDexScreener();
