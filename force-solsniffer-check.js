const axios = require('axios');
require('dotenv').config();

async function checkSolSniffer() {
  const tokenAddress = '7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump';
  const apiKey = process.env.SOLSNIFFER_API_KEY;
  
  console.log('Forcing SolSniffer check for DuckStyle...');
  
  try {
    const response = await axios.get(
      `https://solana-api.sniff.services/v2/tokens/${tokenAddress}/score`,
      {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${apiKey}`
        }
      }
    );
    
    console.log('\nSolSniffer Response:');
    console.log('Score:', response.data.score);
    console.log('Data:', JSON.stringify(response.data, null, 2));
    
    if (response.data.score) {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB
      });
      
      // Update database
      await pool.query(
        `UPDATE tokens 
         SET solsniffer_score = $1, 
             solsniffer_checked_at = NOW(),
             security_data = $2
         WHERE address = $3`,
        [response.data.score, JSON.stringify(response.data), tokenAddress]
      );
      
      console.log('\nDatabase updated!');
      
      if (response.data.score > 60 && response.data.score !== 90) {
        console.log('\n🎯 BUY SIGNAL CRITERIA MET!');
      } else if (response.data.score === 90) {
        console.log('\n❌ Token is BLACKLISTED (score 90)');
      } else {
        console.log('\n❌ Score too low for buy signal');
      }
      
      await pool.end();
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkSolSniffer();
