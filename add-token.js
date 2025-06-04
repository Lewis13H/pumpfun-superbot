const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function addToken(tokenAddress) {
  console.log(`\nChecking token: ${tokenAddress}`);
  
  // 1. Check for duplicates
  const existing = await pool.query(
    'SELECT address, symbol, category, market_cap FROM tokens WHERE address = $1',
    [tokenAddress]
  );
  
  if (existing.rows.length > 0) {
    console.log(`❌ Token already exists in database:`);
    console.log(`   Symbol: ${existing.rows[0].symbol}`);
    console.log(`   Category: ${existing.rows[0].category}`);
    console.log(`   Market Cap: $${existing.rows[0].market_cap}`);
    return;
  }
  
  console.log('✓ Token not in database, fetching data...');
  
  // 2. Fetch token data from Birdeye
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-API-KEY': process.env.BIRDEYE_API_KEY
        }
      }
    );
    
    const data = response.data.data;
    
    if (!data || !data.symbol) {
      console.log('❌ No data found for this token on Birdeye');
      return;
    }
    
    console.log(`\n✓ Found token data:`);
    console.log(`   Symbol: ${data.symbol}`);
    console.log(`   Name: ${data.name}`);
    console.log(`   Market Cap: $${data.marketCap?.toFixed(2) || 0}`);
    console.log(`   Liquidity: $${data.liquidity?.toFixed(2) || 0}`);
    console.log(`   Holders: ${data.holder || 0}`);
    
    // 3. Determine category based on market cap
    let category = 'NEW';
    const marketCap = data.marketCap || 0;
    
    if (marketCap === 0) category = 'NEW';
    else if (marketCap < 8000) category = 'LOW';
    else if (marketCap < 19000) category = 'MEDIUM';
    else if (marketCap < 35000) category = 'HIGH';
    else if (marketCap <= 105000) category = 'AIM';
    else category = 'ARCHIVE';
    
    console.log(`   Category: ${category}`);
    
    // 4. Check if it's a pump.fun token
    const isPumpFun = tokenAddress.toLowerCase().endsWith('pump');
    
    // 5. Insert into database
    const insertQuery = `
      INSERT INTO tokens (
        address, 
        symbol, 
        name, 
        category, 
        market_cap, 
        liquidity, 
        holders,
        is_pump_fun,
        platform,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING address, symbol, category, market_cap
    `;
    
    const values = [
      tokenAddress,
      data.symbol || 'UNKNOWN',
      data.name || data.symbol || 'Unknown Token',
      category,
      marketCap,
      data.liquidity || 0,
      data.holder || null,
      isPumpFun,
      isPumpFun ? 'pumpfun' : 'unknown'
    ];
    
    const result = await pool.query(insertQuery, values);
    
    console.log(`\n✅ Token added successfully!`);
    console.log(`   Category: ${result.rows[0].category}`);
    console.log(`   Market Cap: $${result.rows[0].market_cap}`);
    
    // 6. Add category transition record
    await pool.query(
      `INSERT INTO category_transitions (token_address, from_category, to_category, market_cap_at_transition, reason, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [tokenAddress, 'NEW', category, marketCap, 'Manual addition']
    );
    
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('❌ Token not found on Birdeye');
    } else {
      console.error('❌ Error fetching token data:', error.message);
    }
  } finally {
    await pool.end();
  }
}

// Get token address from command line
const tokenAddress = process.argv[2];

if (!tokenAddress) {
  console.log('Usage: node add-token.js <token_address>');
  console.log('Example: node add-token.js rpe3JvvWtTyFahiXBuenhz7wosciXr8GM2FSgjzpump');
  process.exit(1);
}

addToken(tokenAddress);

