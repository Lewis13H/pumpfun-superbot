// scripts/check-and-fix-schema.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function checkAndFixSchema() {
  try {
    logger.info('Checking existing schema...');

    // First, check what columns exist in pump_fun_curve_snapshots
    const existingColumns = await db.raw(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'pump_fun_curve_snapshots'
      ORDER BY ordinal_position
    `);

    logger.info('Current pump_fun_curve_snapshots columns:');
    existingColumns.rows.forEach((col: any) => {
      logger.info(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Check if table exists
    if (existingColumns.rows.length === 0) {
      logger.info('Table pump_fun_curve_snapshots does not exist. Creating it...');
      
      await db.schema.createTable('pump_fun_curve_snapshots', (table) => {
        table.increments('id').primary();
        table.string('token_address', 44).notNullable();
        table.timestamp('created_at').defaultTo(db.fn.now());
        table.decimal('sol_reserves', 20, 8);
        table.decimal('curve_progress', 5, 2);
        table.decimal('price', 30, 18);
        table.decimal('distance_to_graduation', 20, 2);
        table.decimal('market_cap_usd', 20, 2);
        
        table.index(['token_address', 'created_at']);
      });
      
      logger.info('Created pump_fun_curve_snapshots table');
    } else {
      // Table exists, add missing columns
      logger.info('Adding missing columns...');

      // Add price column if it doesn't exist
      const hasPriceColumn = existingColumns.rows.some((col: any) => col.column_name === 'price');
      if (!hasPriceColumn) {
        await db.raw(`
          ALTER TABLE pump_fun_curve_snapshots 
          ADD COLUMN price DECIMAL(30,18)
        `);
        logger.info('Added price column');
      }

      // Add market_cap_usd column if it doesn't exist
      const hasMarketCapColumn = existingColumns.rows.some((col: any) => col.column_name === 'market_cap_usd');
      if (!hasMarketCapColumn) {
        await db.raw(`
          ALTER TABLE pump_fun_curve_snapshots
          ADD COLUMN market_cap_usd DECIMAL(20,2)
        `);
        logger.info('Added market_cap_usd column');
      }

      // Check if we have a timestamp column (might be named differently)
      const timestampColumn = existingColumns.rows.find((col: any) => 
        col.column_name === 'timestamp' || 
        col.column_name === 'created_at' || 
        col.column_name === 'snapshot_timestamp'
      );

      if (!timestampColumn) {
        // Add timestamp column
        await db.raw(`
          ALTER TABLE pump_fun_curve_snapshots
          ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        `);
        logger.info('Added created_at timestamp column');
      }

      // Create index using the correct column name
      const timestampColumnName = timestampColumn?.column_name || 'created_at';
      logger.info(`Creating index using ${timestampColumnName} column...`);
      
      await db.raw(`
        CREATE INDEX IF NOT EXISTS idx_pump_fun_snapshots_token_time 
        ON pump_fun_curve_snapshots(token_address, ${timestampColumnName} DESC)
      `);
    }

    // Fix estimated_graduation_time data type in tokens table
    logger.info('Fixing estimated_graduation_time data type...');
    try {
      await db.raw(`
        ALTER TABLE tokens 
        ALTER COLUMN estimated_graduation_time TYPE DECIMAL(10,2)
      `);
      logger.info('Updated estimated_graduation_time to DECIMAL(10,2)');
    } catch (error: any) {
      if (error.code === '42804') {
        // Column might need explicit casting
        await db.raw(`
          ALTER TABLE tokens 
          ALTER COLUMN estimated_graduation_time TYPE DECIMAL(10,2) 
          USING estimated_graduation_time::DECIMAL(10,2)
        `);
        logger.info('Updated estimated_graduation_time with explicit casting');
      } else {
        throw error;
      }
    }

    // Verify final schema
    const finalColumns = await db.raw(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns 
      WHERE table_name = 'pump_fun_curve_snapshots'
      ORDER BY ordinal_position
    `);

    logger.info('\nFinal pump_fun_curve_snapshots schema:');
    finalColumns.rows.forEach((col: any) => {
      const type = col.numeric_precision 
        ? `${col.data_type}(${col.numeric_precision},${col.numeric_scale || 0})`
        : col.data_type;
      logger.info(`  - ${col.column_name}: ${type}`);
    });

    // Also update the pumpfun-monitor code to use the correct column name
    logger.info('\n⚠️  IMPORTANT: Update your pumpfun-monitor.ts to use the correct timestamp column name!');
    logger.info('Replace "timestamp" with "created_at" in the insert statement.');

    logger.info('\n✅ Schema fix completed successfully!');

  } catch (error) {
    logger.error('Schema fix failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// Run the check and fix
checkAndFixSchema()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed:', error);
    process.exit(1);
  });