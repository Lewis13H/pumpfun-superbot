// scripts/verify-migration.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function verifyMigration() {
  try {
    // Check if new columns exist
    const columns = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN (
        'decimals', 'description', 'image_url', 
        'rug_pull_risk', 'holder_count'
      )
    `);
    
    logger.info(`Found ${columns.rows.length} new columns (should be 5)`);
    
    // Check if new tables exist
    const tables = await db.raw(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('api_call_logs', 'api_cache')
      AND table_schema = 'public'
    `);
    
    logger.info(`Found ${tables.rows.length} new tables (should be 2)`);
    
    if (columns.rows.length >= 5 && tables.rows.length >= 2) {
      logger.info('✅ Migration verified successfully!');
    } else {
      logger.warn('⚠️  Migration may be incomplete');
    }
    
  } catch (error) {
    logger.error('Verification failed:', error);
  }
  
  process.exit(0);
}

verifyMigration();