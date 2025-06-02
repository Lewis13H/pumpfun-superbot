import { db } from '../src/database/postgres';

async function findToken(symbol: string) {
  const token = await db('tokens')
    .where('symbol', symbol)
    .first();
    
  if (token) {
    console.log('\nToken Details:');
    console.log('Symbol:', token.symbol);
    console.log('Address:', token.address);
    console.log('Category:', token.category);
    console.log('Market Cap: $' + Number(token.market_cap).toLocaleString());
    console.log('Platform:', token.platform);
    console.log('Created:', token.created_at);
  } else {
    console.log('Token not found');
  }
  
  process.exit(0);
}

findToken('Smiley');
