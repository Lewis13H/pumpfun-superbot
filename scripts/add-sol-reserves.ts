// scripts/add-sol-reserves.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function addSolReservesColumn() {
  try {
    logger.info('Adding sol_reserves column...');
    
    await db.raw(`
      ALTER TABLE pump_fun_curve_snapshots 
      ADD COLUMN IF NOT EXISTS sol_reserves DECIMAL(20,8)
    `);
    
    logger.info('✅ Column added successfully!');
    
  } catch (error) {
    logger.error('Failed to add column:', error);
  } finally {
    await db.destroy();
  }
}

addSolReservesColumn();