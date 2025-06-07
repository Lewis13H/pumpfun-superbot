// scripts/quick-db-check.js - Quick database status check
const knex = require('knex');
require('dotenv').config();

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
  }
});

async function quickCheck() {
  try {
    console.log('=== Quick Database Check ===\n');
    
    // 1. Basic counts
    const tokens = await db('tokens').count('* as count');
    const prices = await db('timeseries.token_prices').count('* as count');
    
    console.log(`Total tokens: ${tokens[0].count}`);
    console.log(`Total price records: ${prices[0].count}`);
    
    // 2. Bonding curve status
    const withBC = await db('tokens').whereNotNull('bonding_curve').count('* as count');
    const withoutBC = await db('tokens').whereNull('bonding_curve').count('* as count');
    
    console.log(`\nTokens WITH bonding curves: ${withBC[0].count}`);
    console.log(`Tokens WITHOUT bonding curves: ${withoutBC[0].count}`);
    
    // 3. Recent activity
    const recentTokens = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '5 minutes'"))
      .count('* as count');
    
    const recentPrices = await db('timeseries.token_prices')
      .where('time', '>', db.raw("NOW() - INTERVAL '5 minutes'"))
      .count('* as count');
    
    console.log(`\nLast 5 minutes:`);
    console.log(`- New tokens: ${recentTokens[0].count}`);
    console.log(`- Price updates: ${recentPrices[0].count}`);
    
    // 4. Sample recent tokens
    const samples = await db('tokens')
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('address', 'symbol', 'bonding_curve', 'last_price_update');
    
    console.log('\nRecent tokens:');
    samples.forEach(t => {
      console.log(`- ${t.address.substring(0, 10)}... | ${t.symbol} | BC: ${t.bonding_curve ? 'YES' : 'NO'} | Price Update: ${t.last_price_update ? 'YES' : 'NO'}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.destroy();
  }
}

quickCheck();