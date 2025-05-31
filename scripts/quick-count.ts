import { db } from '../src/database/postgres';

async function quickCount() {
  const count = await db('tokens').count('* as total');
  console.log(`Current token count: ${count[0].total}`);
  
  const recentCount = await db('tokens')
    .where('created_at', '>', new Date(Date.now() - 5 * 60 * 1000))
    .count('* as recent');
  
  console.log(`Tokens in last 5 minutes: ${recentCount[0].recent}`);
  
  await db.destroy();
}

quickCount();
