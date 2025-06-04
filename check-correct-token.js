const axios = require("axios");

async function checkCorrectToken() {
  // The CORRECT address from pump.fun
  const correctAddress = "7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump";
  const url = `https://api.dexscreener.com/latest/dex/tokens/${correctAddress}`;
  
  try {
    const response = await axios.get(url);
    const pairs = response.data.pairs || [];
    
    console.log("Checking CORRECT address:", correctAddress);
    console.log("Number of pairs found:", pairs.length);
    
    if (pairs.length > 0) {
      const pair = pairs[0];
      console.log("\nFirst Pair Data:");
      console.log("  Symbol:", pair.baseToken?.symbol);
      console.log("  Market Cap:", pair.marketCap);
      console.log("  FDV:", pair.fdv);
      console.log("  Price USD:", pair.priceUsd);
      console.log("  Liquidity:", JSON.stringify(pair.liquidity));
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkCorrectToken();
