import { db } from '../src/database/postgres';

async function checkPool() {
  const pool = db.client.pool;
  console.log('Database Pool Configuration:');
  console.log('  Min connections:', pool.min);
  console.log('  Max connections:', pool.max);
  console.log('  Used connections:', pool.used);
  console.log('  Free connections:', pool.free);
  console.log('  Pending acquires:', pool.pendingAcquires);
  console.log('  Pending creates:', pool.pendingCreates);
  
  await db.destroy();
}

checkPool();