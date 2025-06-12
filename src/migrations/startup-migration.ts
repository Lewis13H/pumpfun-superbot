import { db } from '../database/postgres';
import { logger } from '../utils/logger';

// Define market cap thresholds
const MARKET_CAP_THRESHOLDS = {
  ARCHIVE: 8000,      // Below $8k
  LOW: 15000,         // $8k-$15k
  MEDIUM: 25000,      // $15k-$25k
  HIGH: 35000,        // $25k-$35k
  AIM: 105000,        // $35k-$105k
  GRADUATED: 105000   // Above $105k
};

interface Token {
  address: string;
  symbol?: string;
  market_cap?: number;
}

/**
 * Check and run migrations on application startup
 * This ensures the application can handle legacy data gracefully
 */
export async function runStartupMigrations(): Promise<void> {
  logger.info('Running startup migration checks...');
  
  try {
    // Check for NEW category tokens
    await checkAndMigrateNewTokens();
    
    // Add other migration checks here as needed
    
    logger.info('✅ Startup migrations complete');
  } catch (error) {
    logger.error('❌ Startup migration failed:', error);
    throw new Error('Failed to run startup migrations. Application cannot continue safely.');
  }
}

/**
 * Check for and migrate any remaining NEW category tokens
 */
async function checkAndMigrateNewTokens(): Promise<void> {
  const result = await db('tokens')
    .where('category', 'NEW')
    .count('* as count')
    .first();
  
  const count = typeof result?.count === 'number' ? result.count : parseInt(result?.count || '0');
  
  if (count === 0) {
    logger.info('No NEW category tokens found - skipping migration');
    return;
  }
  
  logger.warn(`Found ${count} tokens with legacy NEW category - running migration...`);
  
  await db.transaction(async (trx: any) => {
    // Get all NEW tokens for logging
    const tokensToMigrate: Token[] = await trx('tokens')
      .where('category', 'NEW')
      .select('address', 'symbol', 'market_cap');
    
    // Update categories based on market cap
    const updateQuery = `
      UPDATE public.tokens
      SET 
        category = CASE
          WHEN market_cap < ? THEN 'ARCHIVE'
          WHEN market_cap >= ? AND market_cap < ? THEN 'LOW'
          WHEN market_cap >= ? AND market_cap < ? THEN 'MEDIUM'
          WHEN market_cap >= ? AND market_cap < ? THEN 'HIGH'
          WHEN market_cap >= ? AND market_cap < ? THEN 'AIM'
          WHEN market_cap >= ? THEN 'GRADUATED'
          ELSE 'LOW'
        END,
        updated_at = NOW()
      WHERE category = 'NEW'
    `;
    
    await trx.raw(updateQuery, [
      MARKET_CAP_THRESHOLDS.ARCHIVE,
      MARKET_CAP_THRESHOLDS.ARCHIVE,
      MARKET_CAP_THRESHOLDS.LOW,
      MARKET_CAP_THRESHOLDS.LOW,
      MARKET_CAP_THRESHOLDS.MEDIUM,
      MARKET_CAP_THRESHOLDS.MEDIUM,
      MARKET_CAP_THRESHOLDS.HIGH,
      MARKET_CAP_THRESHOLDS.HIGH,
      MARKET_CAP_THRESHOLDS.AIM,
      MARKET_CAP_THRESHOLDS.GRADUATED
    ]);
    
    // Log transitions
    const transitions = tokensToMigrate.map((token: Token) => {
      const newCategory = determineCategory(token.market_cap || 0);
      return {
        token_address: token.address,
        from_category: 'NEW',
        to_category: newCategory,
        market_cap_at_transition: token.market_cap || 0,
        reason: 'startup_migration',
        created_at: new Date()
      };
    });
    
    if (transitions.length > 0) {
      await trx('category_transitions').insert(transitions);
    }
    
    logger.info(`Successfully migrated ${count} tokens from NEW category`);
  });
}

/**
 * Helper to determine category from market cap
 */
function determineCategory(marketCap: number): string {
  if (marketCap < MARKET_CAP_THRESHOLDS.ARCHIVE) return 'ARCHIVE';
  if (marketCap < MARKET_CAP_THRESHOLDS.LOW) return 'LOW';
  if (marketCap < MARKET_CAP_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (marketCap < MARKET_CAP_THRESHOLDS.HIGH) return 'HIGH';
  if (marketCap < MARKET_CAP_THRESHOLDS.AIM) return 'AIM';
  return 'GRADUATED';
}

/**
 * Validate database schema and constraints
 */
export async function validateDatabaseSchema(): Promise<void> {
  logger.info('Validating database schema...');
  
  // Check if required tables exist
  const requiredTables = ['tokens', 'category_transitions'];
  
  for (const table of requiredTables) {
    const exists = await db.schema.hasTable(table);
    if (!exists) {
      throw new Error(`Required table '${table}' does not exist`);
    }
  }
  
  // Check timeseries schema tables if they exist
  try {
    const timeseriesTables = ['token_prices', 'token_transactions'];
    for (const table of timeseriesTables) {
      const query = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'timeseries' 
          AND table_name = ?
        )
      `;
      const result = await db.raw(query, [table]);
      if (!result.rows[0].exists) {
        logger.warn(`TimeSeries table 'timeseries.${table}' does not exist`);
      }
    }
  } catch (error) {
    logger.warn('Could not check timeseries tables:', error);
  }
  
  logger.info('✅ Database schema validation passed');
}

/**
 * Main startup check function to be called from application entry point
 */
export async function performStartupChecks(): Promise<void> {
  logger.info('=== Performing startup checks ===');
  
  try {
    // Validate database connection
    await db.raw('SELECT 1');
    logger.info('✅ Database connection verified');
    
    // Validate schema
    await validateDatabaseSchema();
    
    // Run migrations
    await runStartupMigrations();
    
    logger.info('=== All startup checks passed ===');
  } catch (error) {
    logger.error('Startup checks failed:', error);
    throw error;
  }
}