const { db } = require('./src/database/postgres');
const { BirdeyeClient } = require('./src/api/birdeye-client');
const { config } = require('./src/config');

async function test() {
  console.log('Testing Birdeye API...');
  const client = new BirdeyeClient(config.apis.birdeyeApiKey);
  
  try {
    const result = await client.getTokenOverview('So11111111111111111111111111111111111112'); // SOL
    console.log('Birdeye works:', result);
  } catch (error) {
    console.log('Birdeye error:', error.message);
  }
  
  // Check for tokens with market cap
  const tokens = await db('tokens')
    .where('market_cap', '>', 0)
    .count('* as count')
    .first();
  
  console.log('Tokens with market_cap > 0:', tokens.count);
  
  process.exit(0);
}

test();
