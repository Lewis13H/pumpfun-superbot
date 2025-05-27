// scripts/apply-migration.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function applyMigration() {
  logger.info('Applying Module 2A database migration...');

  try {
    // Add metadata fields to tokens table
    await db.raw(`
      ALTER TABLE tokens 
      ADD COLUMN IF NOT EXISTS decimals INTEGER DEFAULT 9,
      ADD COLUMN IF NOT EXISTS total_supply DECIMAL(30,0),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS website VARCHAR(255),
      ADD COLUMN IF NOT EXISTS twitter VARCHAR(255),
      ADD COLUMN IF NOT EXISTS telegram VARCHAR(255)
    `);
    logger.info('✓ Added metadata fields');

    // Add security-related fields
    await db.raw(`
      ALTER TABLE tokens
      ADD COLUMN IF NOT EXISTS rug_pull_risk DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS liquidity_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS lp_burned BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS mint_authority_revoked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS freeze_authority_revoked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS buy_tax DECIMAL(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sell_tax DECIMAL(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false
    `);
    logger.info('✓ Added security fields');

    // Add holder-related fields
    await db.raw(`
      ALTER TABLE tokens
      ADD COLUMN IF NOT EXISTS holder_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS top_10_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS developer_percentage DECIMAL(5,2),
      ADD COLUMN IF NOT EXISTS concentration_risk VARCHAR(20)
    `);
    logger.info('✓ Added holder fields');

    // Add market data fields
    await db.raw(`
      ALTER TABLE tokens
      ADD COLUMN IF NOT EXISTS price_change_24h DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS price_change_7d DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS fdv DECIMAL(20,2),
      ADD COLUMN IF NOT EXISTS circulating_supply DECIMAL(30,0)
    `);
    logger.info('✓ Added market data fields');

    // Add API tracking fields
    await db.raw(`
      ALTER TABLE tokens
      ADD COLUMN IF NOT EXISTS last_api_update TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS api_data_sources JSONB,
      ADD COLUMN IF NOT EXISTS api_errors JSONB
    `);
    logger.info('✓ Added API tracking fields');

    // Create indexes
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_tokens_api_update ON tokens(last_api_update)
    `);
    logger.info('✓ Created indexes');

    // Create API call logs table
    await db.raw(`
      CREATE TABLE IF NOT EXISTS api_call_logs (
        id SERIAL PRIMARY KEY,
        api_name VARCHAR(50) NOT NULL,
        endpoint VARCHAR(255) NOT NULL,
        token_address VARCHAR(44),
        status_code INTEGER,
        response_time_ms INTEGER,
        error_message TEXT,
        rate_limit_remaining INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_api_logs_api ON api_call_logs(api_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_logs_token ON api_call_logs(token_address, created_at DESC);
    `);
    logger.info('✓ Created API logs table');

    // Create API cache table
    await db.raw(`
      CREATE TABLE IF NOT EXISTS api_cache (
        cache_key VARCHAR(255) PRIMARY KEY,
        api_name VARCHAR(50) NOT NULL,
        token_address VARCHAR(44),
        response_data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);
    
    await db.raw(`
      CREATE INDEX IF NOT EXISTS idx_api_cache_token ON api_cache(token_address);
      CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
    `);
    logger.info('✓ Created API cache table');

    // Update analysis history table
    await db.raw(`
      ALTER TABLE token_analysis_history
      ADD COLUMN IF NOT EXISTS api_sources JSONB,
      ADD COLUMN IF NOT EXISTS api_fetch_time_ms INTEGER,
      ADD COLUMN IF NOT EXISTS data_completeness_score DECIMAL(5,2)
    `);
    logger.info('✓ Updated analysis history table');

    logger.info('✅ Migration completed successfully!');
    
    // Show current table structure
    const result = await db.raw(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tokens'
      ORDER BY ordinal_position
    `);
    
    logger.info('Current tokens table structure:');
    console.table(result.rows);
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the migration
applyMigration();