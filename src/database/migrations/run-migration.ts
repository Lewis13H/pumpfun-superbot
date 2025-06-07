import { db } from '../postgres';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger';

async function runMigration(direction: 'up' | 'down' = 'up') {
  const version = '001_add_category_system';
  const filename = direction === 'up' 
    ? `${version}.sql` 
    : `${version}_rollback.sql`;
  
  try {
    // Check if already applied
    if (direction === 'up') {
      const existing = await db('schema_migrations')
        .where('version', version)
        .first();
      
      if (existing) {
        logger.info(`Migration ${version} already applied`);
        return;
      }
    }
    
    // Read migration file
    const sqlPath = join(__dirname, filename);
    const sql = readFileSync(sqlPath, 'utf8');
    
    // Run migration
    logger.info(`Running migration ${version} (${direction})`);
    await db.raw(sql);
    
    logger.info(`Migration ${version} completed successfully`);
  } catch (error) {
    logger.error(`Migration ${version} failed:`, error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const direction = process.argv[2] as 'up' | 'down' || 'up';
  runMigration(direction)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigration };

