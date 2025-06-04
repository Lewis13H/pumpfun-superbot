const axios = require("axios");

async function checkDexScreener() {
  const tokenAddress = "7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump";
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  
  try {
    const response = await axios.get(url);
    const pairs = response.data.pairs || [];
    
    console.log("DexScreener Response for", tokenAddress);
    console.log("Number of pairs found:", pairs.length);
    
    pairs.forEach((pair, i) => {
      console.log(`\nPair ${i + 1}:`);
      console.log("  Market Cap:", pair.marketCap);
      console.log("  FDV:", pair.fdv);
      console.log("  Price USD:", pair.priceUsd);
      console.log("  Liquidity:", pair.liquidity);
      console.log("  DEX:", pair.dexId);
      console.log("  Pair Address:", pair.pairAddress);
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkDexScreener();
