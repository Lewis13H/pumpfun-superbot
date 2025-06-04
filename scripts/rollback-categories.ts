import { db } from '../src/database/postgres';

async function rollbackCategories() {
  console.log('=== Rollback Category System ===\n');
  console.log('⚠️  WARNING: This will remove all category data!\n');
  
  try {
    // Step 1: Stop all services
    console.log('Step 1: Ensure all services are stopped');
    console.log('Please stop the application before continuing...');
    
    // Step 2: Restore monitoring_priority from category
    console.log('\nStep 2: Restoring monitoring_priority...');
    
    await db('tokens')
      .where('category', 'HIGH')
      .orWhere('category', 'AIM')
      .update({ monitoring_priority: 'high' });
    
    await db('tokens')
      .where('category', 'MEDIUM')
      .update({ monitoring_priority: 'normal' });
    
    await db('tokens')
      .whereIn('category', ['LOW', 'NEW', 'ARCHIVE', 'BIN'])
      .update({ monitoring_priority: 'normal' });
    
    console.log('✅ Monitoring priorities restored');
    
    // Step 3: Run rollback migration
    console.log('\nStep 3: Rolling back database schema...');
    
    const sql = `
      BEGIN;
      
      -- Remove new tables
      DROP TABLE IF EXISTS buy_evaluations CASCADE;
      DROP TABLE IF EXISTS category_transitions CASCADE;
      
      -- Remove category columns
      ALTER TABLE tokens 
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS category_updated_at,
      DROP COLUMN IF EXISTS previous_category,
      DROP COLUMN IF EXISTS category_scan_count,
      DROP COLUMN IF EXISTS aim_attempts,
      DROP COLUMN IF EXISTS buy_attempts,
      DROP COLUMN IF EXISTS buy_failure_reasons,
      DROP COLUMN IF EXISTS top_10_percent,
      DROP COLUMN IF EXISTS solsniffer_score,
      DROP COLUMN IF EXISTS solsniffer_checked_at;
      
      -- Remove from scan_logs
      ALTER TABLE scan_logs
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS scan_number,
      DROP COLUMN IF EXISTS is_final_scan;
      
      COMMIT;
    `;
    
    await db.raw(sql);
    console.log('✅ Database schema rolled back');
    
    // Step 4: Verify rollback
    console.log('\nStep 4: Verifying rollback...');
    
    const columns = await db('tokens').columnInfo();
    if ('category' in columns) {
      throw new Error('Category column still exists!');
    }
    
    console.log('✅ Rollback completed successfully');
    console.log('\n⚠️  Remember to restart with the old codebase!');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    process.exit(1);
  }
}

// Confirmation
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question('This will REMOVE the category system. Are you sure? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes') {
    rollbackCategories()
      .then(() => {
        readline.close();
        process.exit(0);
      });
  } else {
    console.log('Rollback cancelled');
    readline.close();
  }
});
