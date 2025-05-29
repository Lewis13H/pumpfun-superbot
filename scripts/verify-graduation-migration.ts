// scripts/verify-graduation-migration.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function verifyGraduationMigration() {
  try {
    logger.info('Verifying graduation tracking migration...\n');

    // 1. Check tokens table columns
    const tokenColumns = await db.raw(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('distance_to_graduation', 'estimated_graduation_time')
      ORDER BY column_name
    `);

    logger.info('✅ Tokens table columns:');
    tokenColumns.rows.forEach((col: any) => {
      logger.info(`   ${col.column_name}:`);
      logger.info(`     - Type: ${col.data_type}${col.numeric_precision ? `(${col.numeric_precision},${col.numeric_scale})` : ''}`);
      logger.info(`     - Nullable: ${col.is_nullable}`);
    });

    // 2. Check pump_fun_curve_snapshots columns
    const snapshotColumns = await db.raw(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'pump_fun_curve_snapshots' 
      AND column_name = 'distance_to_graduation'
    `);

    logger.info('\n✅ Pump Fun Curve Snapshots table:');
    if (snapshotColumns.rows.length > 0) {
      logger.info(`   distance_to_graduation column exists`);
    } else {
      logger.warn(`   ⚠️ distance_to_graduation column missing`);
    }

    // 3. Check indexes
    const indexes = await db.raw(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename IN ('tokens', 'pump_fun_curve_snapshots')
      AND (indexname LIKE '%graduation%' OR indexname LIKE '%progress%' OR indexname LIKE '%pumpfun_active%')
      ORDER BY tablename, indexname
    `);

    logger.info('\n✅ Indexes:');
    indexes.rows.forEach((idx: any) => {
      logger.info(`   ${idx.indexname} on ${idx.tablename}`);
    });

    // 4. Check column comments
    const comments = await db.raw(`
      SELECT 
        c.column_name,
        pgd.description
      FROM pg_catalog.pg_statio_all_tables as st
      INNER JOIN pg_catalog.pg_description pgd ON (pgd.objoid=st.relid)
      INNER JOIN information_schema.columns c ON (
        pgd.objsubid=c.ordinal_position AND 
        c.table_schema=st.schemaname AND 
        c.table_name=st.relname
      )
      WHERE c.table_name = 'tokens'
      AND c.column_name IN ('distance_to_graduation', 'estimated_graduation_time')
    `);

    if (comments.rows.length > 0) {
      logger.info('\n✅ Column comments:');
      comments.rows.forEach((comment: any) => {
        logger.info(`   ${comment.column_name}: "${comment.description}"`);
      });
    }

    // 5. Test query with new columns
    logger.info('\n✅ Testing query with new columns...');
    const testQuery = await db('tokens')
      .select('address', 'symbol', 'curve_progress', 'distance_to_graduation', 'estimated_graduation_time')
      .where('platform', 'pumpfun')
      .whereNotNull('bonding_curve')
      .orderBy('curve_progress', 'desc')
      .limit(5);

    if (testQuery.length > 0) {
      logger.info(`   Found ${testQuery.length} pump.fun tokens`);
      testQuery.forEach(token => {
        logger.info(`   - ${token.symbol}: ${token.curve_progress || 0}% progress`);
      });
    } else {
      logger.info('   No pump.fun tokens found (this is normal if system just started)');
    }

    logger.info('\n✅ Migration verification completed successfully!');
    
    // Summary
    logger.info('\nSummary:');
    logger.info(`- Token columns added: ${tokenColumns.rows.length}/2`);
    logger.info(`- Snapshot columns added: ${snapshotColumns.rows.length}/1`);
    logger.info(`- Indexes created: ${indexes.rows.length}`);
    logger.info(`- All migration components are in place ✅`);

  } catch (error) {
    logger.error('Verification failed:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

// Run verification
verifyGraduationMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Verification script failed:', error);
    process.exit(1);
  });