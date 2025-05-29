// scripts/run-graduation-migration.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';
import fs from 'fs';
import path from 'path';

async function runGraduationMigration() {
  try {
    logger.info('Starting graduation tracking migration...');

    // Check if columns already exist
    const tokenColumns = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('distance_to_graduation', 'estimated_graduation_time')
    `);

    if (tokenColumns.rows.length === 2) {
      logger.info('Graduation tracking columns already exist, skipping migration');
      return;
    }

    // Run the migration
    logger.info('Adding graduation tracking columns...');
    
    // Add columns to tokens table
    await db.schema.alterTable('tokens', (table) => {
      table.decimal('distance_to_graduation', 20, 2).nullable();
      table.integer('estimated_graduation_time').nullable();
    });

    // Add column to pump_fun_curve_snapshots
    await db.schema.alterTable('pump_fun_curve_snapshots', (table) => {
      table.decimal('distance_to_graduation', 20, 2).nullable();
    });

    // Create indexes
    logger.info('Creating indexes...');
    
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_tokens_graduation 
      ON tokens(platform, curve_progress) 
      WHERE platform = 'pumpfun' AND curve_progress > 50
    `);

    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_curve_snapshots_progress
      ON pump_fun_curve_snapshots(token_address, curve_progress)
    `);

    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_tokens_pumpfun_active
      ON tokens(address, bonding_curve)
      WHERE platform = 'pumpfun' AND is_pump_fun = true
    `);

    // Add column comments
    await db.raw(`
      COMMENT ON COLUMN tokens.distance_to_graduation 
      IS 'SOL amount needed to reach Raydium migration (69,420 SOL target)'
    `);

    await db.raw(`
      COMMENT ON COLUMN tokens.estimated_graduation_time 
      IS 'Estimated minutes until graduation based on recent growth rate'
    `);

    logger.info('✅ Graduation tracking migration completed successfully!');

    // Verify the migration
    const verifyTokens = await db.raw(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('distance_to_graduation', 'estimated_graduation_time')
      ORDER BY column_name
    `);

    logger.info('New columns added:');
    verifyTokens.rows.forEach((col: any) => {
      logger.info(`  - ${col.column_name}: ${col.data_type}`);
    });

    // Check indexes
    const indexes = await db.raw(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN ('tokens', 'pump_fun_curve_snapshots')
      AND indexname LIKE '%graduation%' OR indexname LIKE '%progress%'
    `);

    logger.info(`Created ${indexes.rows.length} indexes for graduation tracking`);

  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// Run the migration
runGraduationMigration()
  .then(() => {
    logger.info('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration script failed:', error);
    process.exit(1);
  });