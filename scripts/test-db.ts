import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function testDatabase() {
  try {
    // Test raw query
    const result = await db.raw('SELECT NOW() as current_time');
    logger.info('Database test successful:', result.rows[0]);
    
    // Test table exists
    const tables = await db.raw(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    logger.info('Tables in database:', tables.rows);
    
    process.exit(0);
  } catch (error) {
    logger.error('Database test failed:', error);
    process.exit(1);
  }
}

testDatabase();