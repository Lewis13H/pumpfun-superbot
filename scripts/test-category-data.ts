import { db } from '../src/database/postgres';

async function insertTestData() {
  // Insert test tokens in different categories
  const testTokens = [
    { address: 'TEST1...', symbol: 'LOW1', market_cap: 5000, category: 'LOW' },
    { address: 'TEST2...', symbol: 'MED1', market_cap: 15000, category: 'MEDIUM' },
    { address: 'TEST3...', symbol: 'HIGH1', market_cap: 25000, category: 'HIGH' },
    { address: 'TEST4...', symbol: 'AIM1', market_cap: 45000, category: 'AIM' },
  ];
  
  for (const token of testTokens) {
    await db('tokens').insert({
      ...token,
      name: `Test ${token.symbol}`,
      platform: 'test',
      liquidity: token.market_cap * 0.3,
      volume_24h: token.market_cap * 0.1,
      created_at: new Date(),
      discovered_at: new Date(),
    }).onConflict('address').merge();
  }
  
  console.log('Test data inserted');
}

insertTestData()
  .then(() => process.exit(0))
  .catch(console.error);
