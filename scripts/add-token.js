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
  
  // 1. Check for duplicates BY ADDRESS ONLY
  const existing = await pool.query(
    'SELECT address, symbol, category, market_cap FROM tokens WHERE address = $1',
    [tokenAddress]
  );
  
  if (existing.rows.length > 0) {
    console.log(`❌ Token already exists in database:`);
    console.log(`   Symbol: ${existing.rows[0].symbol}`);
    console.log(`   Category: ${existing.rows[0].category}`);
    console.log(`   Market Cap: $${existing.rows[0].market_cap}`);
    await pool.end();
    return;
  }
  
  console.log('✓ Token not in database, fetching data...');
  
  // 2. Try Birdeye first
  let tokenData = await fetchFromBirdeye(tokenAddress);
  
  // 3. Fallback to DexScreener if Birdeye fails
  if (!tokenData) {
    console.log('Trying DexScreener...');
    tokenData = await fetchFromDexScreener(tokenAddress);
  }
  
  if (!tokenData) {
    console.log('❌ Could not find token data from any source');
    await pool.end();
    return;
  }
  
  // 4. Determine category
  const category = determineCategory(tokenData.marketCap);
  
  console.log(`\n✓ Found token data:`);
  console.log(`   Symbol: ${tokenData.symbol}`);
  console.log(`   Name: ${tokenData.name}`);
  console.log(`   Market Cap: $${tokenData.marketCap?.toFixed(2) || 0}`);
  console.log(`   Liquidity: $${tokenData.liquidity?.toFixed(2) || 0}`);
  console.log(`   Holders: ${tokenData.holders || 'Unknown'}`);
  console.log(`   Category: ${category}`);
  
  // 5. Insert into database
  try {
    const result = await pool.query(`
      INSERT INTO tokens (
        address, symbol, name, category, market_cap, 
        liquidity, holders, is_pump_fun, platform,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *
    `, [
      tokenAddress,
      tokenData.symbol,
      tokenData.name,
      category,
      tokenData.marketCap || 0,
      tokenData.liquidity || 0,
      tokenData.holders || null,
      tokenAddress.endsWith('pump'),
      tokenAddress.endsWith('pump') ? 'pumpfun' : 'unknown'
    ]);
    
    console.log(`\n✅ Token added successfully!`);
    
    // Add category transition
    await pool.query(
      `INSERT INTO category_transitions 
       (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [tokenAddress, 'NEW', category, tokenData.marketCap || 0, 'Manual addition']
    );
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
  }
  
  await pool.end();
}

async function fetchFromBirdeye(address) {
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview?address=${address}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-API-KEY': process.env.BIRDEYE_API_KEY
        },
        timeout: 10000
      }
    );
    
    const data = response.data.data;
    if (!data) return null;
    
    return {
      symbol: data.symbol,
      name: data.name,
      marketCap: data.marketCap || 0,
      liquidity: data.liquidity || 0,
      holders: data.holder || 0
    };
  } catch (error) {
    return null;
  }
}

async function fetchFromDexScreener(address) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 10000 }
    );
    
    const pairs = response.data.pairs;
    if (!pairs || pairs.length === 0) return null;
    
    const pair = pairs[0];
    return {
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      marketCap: parseFloat(pair.fdv || 0),
      liquidity: parseFloat(pair.liquidity?.usd || pair.liquidity || 0),
      holders: 0 // DexScreener doesn't provide
    };
  } catch (error) {
    return null;
  }
}

function determineCategory(marketCap) {
  if (!marketCap || marketCap === 0) return 'NEW';
  if (marketCap < 8000) return 'LOW';
  if (marketCap < 19000) return 'MEDIUM';
  if (marketCap < 35000) return 'HIGH';
  if (marketCap <= 145000) return 'AIM';
  return 'ARCHIVE';
}

// Main execution
const tokenAddress = process.argv[2];

if (!tokenAddress) {
  console.log('Usage: node add-token.js <token_address>');
  console.log('Example: node add-token.js 7JQSGgM6JLqfHkyqWivxshge8hjNPgK4ZZHyQJPmpump');
  process.exit(1);
}

if (tokenAddress.length < 32) {
  console.log('❌ Invalid token address (too short)');
  process.exit(1);
}

addToken(tokenAddress);