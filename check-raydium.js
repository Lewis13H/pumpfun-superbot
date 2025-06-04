const axios = require("axios");

async function checkRaydium() {
  const addresses = [
    "7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump",
    "7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump"
  ];
  
  for (const address of addresses) {
    console.log(`\nChecking Raydium for: ${address}`);
    
    try {
      // Check Raydium API
      const response = await axios.get(
        `https://api.raydium.io/v2/main/pairs?baseMint=${address}`,
        { timeout: 5000 }
      );
      
      console.log("Raydium pairs:", response.data);
    } catch (error) {
      console.log("Error:", error.message);
    }
  }
}

checkRaydium();
