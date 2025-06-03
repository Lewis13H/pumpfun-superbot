import { db } from '../src/database/postgres';

async function fixConnections() {
  console.log('Checking database connections...');
  
  try {
    // Kill idle connections
    const result = await db.raw(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = 'memecoin_discovery' 
      AND pid <> pg_backend_pid() 
      AND state = 'idle' 
      AND state_change < current_timestamp - interval '5 minutes'
    `);
    
    console.log('Terminated idle connections:', result.rowCount);
    
    // Check current connections
    const connections = await db.raw(`
      SELECT count(*) as total,
             count(*) FILTER (WHERE state = 'active') as active,
             count(*) FILTER (WHERE state = 'idle') as idle,
             count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
      FROM pg_stat_activity
      WHERE datname = 'memecoin_discovery'
    `);
    
    console.log('Connection stats:', connections.rows[0]);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

fixConnections();