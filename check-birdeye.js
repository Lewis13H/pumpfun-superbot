const axios = require("axios");

async function checkBirdeye() {
  // Try both addresses
  const addresses = [
    "7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump", // Database version
    "7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump"  // Pump.fun version
  ];
  
  const apiKey = process.env.BIRDEYE_API_KEY;
  
  for (const address of addresses) {
    console.log(`\nChecking Birdeye for: ${address}`);
    
    try {
      const response = await axios.get(
        `https://public-api.birdeye.so/defi/token_overview?address=${address}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-API-KEY': apiKey
          }
        }
      );
      
      console.log("Response:", JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log("Error:", error.response?.status || error.message);
    }
  }
}

// Load env vars
require('dotenv').config();
checkBirdeye();
