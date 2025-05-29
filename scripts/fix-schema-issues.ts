// scripts/fix-schema-issues.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function fixSchemaIssues() {
  try {
    logger.info('Starting schema fix migration...');

    // 1. Add missing price column to pump_fun_curve_snapshots
    logger.info('Adding price column to pump_fun_curve_snapshots...');
    await db.raw(`
      ALTER TABLE pump_fun_curve_snapshots 
      ADD COLUMN IF NOT EXISTS price DECIMAL(30,18)
    `);

    // 2. Fix estimated_graduation_time data type
    logger.info('Updating estimated_graduation_time data type...');
    await db.raw(`
      ALTER TABLE tokens 
      ALTER COLUMN estimated_graduation_time TYPE DECIMAL(10,2)
    `);

    // 3. Add market_cap_usd column for future use
    logger.info('Adding market_cap_usd column...');
    await db.raw(`
      ALTER TABLE pump_fun_curve_snapshots
      ADD COLUMN IF NOT EXISTS market_cap_usd DECIMAL(20,2)
    `);

    // 4. Add indexes
    logger.info('Creating indexes...');
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_pump_fun_snapshots_token_time 
      ON pump_fun_curve_snapshots(token_address, timestamp DESC)
    `);

    // 5. Add comments
    await db.raw(`
      COMMENT ON COLUMN pump_fun_curve_snapshots.price 
      IS 'Token price in SOL at snapshot time'
    `);

    await db.raw(`
      COMMENT ON COLUMN pump_fun_curve_snapshots.market_cap_usd 
      IS 'Market cap in USD at snapshot time'
    `);

    // Verify the changes
    const snapshotColumns = await db.raw(`
      SELECT 
        column_name, 
        data_type, 
        numeric_precision,
        numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'pump_fun_curve_snapshots'
      ORDER BY ordinal_position
    `);

    logger.info('pump_fun_curve_snapshots columns after migration:');
    snapshotColumns.rows.forEach((col: any) => {
      logger.info(`  - ${col.column_name}: ${col.data_type}${col.numeric_precision ? `(${col.numeric_precision},${col.numeric_scale || 0})` : ''}`);
    });

    const tokenColumn = await db.raw(`
      SELECT 
        column_name, 
        data_type, 
        numeric_precision,
        numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name = 'estimated_graduation_time'
    `);

    logger.info('\ntokens.estimated_graduation_time after migration:');
    if (tokenColumn.rows.length > 0) {
      const col = tokenColumn.rows[0];
      logger.info(`  - ${col.column_name}: ${col.data_type}(${col.numeric_precision},${col.numeric_scale || 0})`);
    }

    logger.info('\n✅ Schema fix migration completed successfully!');

  } catch (error) {
    logger.error('Schema fix migration failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// Run the migration
fixSchemaIssues()
  .then(() => {
    logger.info('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration failed:', error);
    process.exit(1);
  });