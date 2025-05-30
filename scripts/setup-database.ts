import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function setupDatabase() {
  console.log('Setting up database tables...\n');
  
  try {
    // Create tokens table
    await db.schema.createTable('tokens', (table) => {
      table.string('address', 44).primary();
      table.string('symbol', 50);
      table.string('name', 255);
      table.string('platform', 50).defaultTo('unknown');
      table.decimal('market_cap', 20, 2);
      table.decimal('price', 30, 18);
      table.decimal('volume_24h', 20, 2);
      table.decimal('liquidity', 20, 2);
      table.decimal('safety_score', 5, 4).defaultTo(0.5);
      table.decimal('potential_score', 5, 4).defaultTo(0.5);
      table.decimal('composite_score', 5, 4).defaultTo(0.5);
      table.string('analysis_tier', 20);
      table.string('investment_classification', 20);
      table.string('analysis_status', 20).defaultTo('PENDING');
      table.boolean('is_pump_fun').defaultTo(false);
      table.string('bonding_curve', 44);
      table.string('associated_bonding_curve', 44);
      table.string('creator', 44);
      table.string('creator_vault', 44);
      table.decimal('initial_price_sol', 30, 18);
      table.decimal('initial_liquidity_sol', 20, 8);
      table.decimal('curve_progress', 5, 4);
      table.decimal('distance_to_graduation', 20, 2);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
    console.log('✓ Created tokens table');
    
    // Create enhanced_token_metrics table
    await db.schema.createTable('enhanced_token_metrics', (table) => {
      table.string('token_address', 44).primary();
      table.decimal('market_cap', 20, 2);
      table.string('market_cap_trend', 20);
      table.decimal('market_cap_velocity', 10, 6);
      table.decimal('graduation_distance', 5, 4);
      table.decimal('total_liquidity', 20, 2);
      table.decimal('liquidity_locked_percentage', 5, 2);
      table.boolean('lp_burned').defaultTo(false);
      table.decimal('slippage_1k', 5, 4);
      table.decimal('liquidity_to_mc_ratio', 10, 6);
      table.decimal('volume_24h', 20, 2);
      table.string('volume_trend', 20);
      table.decimal('volume_to_liquidity_ratio', 10, 6);
      table.integer('unique_traders_24h');
      table.decimal('avg_trade_size', 15, 2);
      table.integer('buy_count_24h');
      table.integer('sell_count_24h');
      table.decimal('buy_pressure', 5, 4);
      table.integer('total_tx_count_24h');
      table.integer('large_tx_count_24h');
      table.timestamp('last_updated').defaultTo(db.fn.now());
    });
    console.log('✓ Created enhanced_token_metrics table');
    
    // Create api_call_logs table
    await db.schema.createTable('api_call_logs', (table) => {
      table.increments('id');
      table.timestamp('timestamp').defaultTo(db.fn.now());
      table.string('service', 50);
      table.string('endpoint', 255);
      table.string('token_address', 44);
      table.decimal('cost', 10, 6);
      table.integer('response_time_ms');
      table.integer('status_code');
      table.text('error_message');
    });
    console.log('✓ Created api_call_logs table');
    
    // Create pump_fun_curve_snapshots table
    await db.schema.createTable('pump_fun_curve_snapshots', (table) => {
      table.increments('id');
      table.string('token_address', 44);
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.decimal('sol_reserves', 20, 8);
      table.decimal('curve_progress', 5, 4);
      table.decimal('price', 30, 18);
      table.decimal('distance_to_graduation', 20, 2);
      table.decimal('market_cap_usd', 20, 2);
    });
    console.log('✓ Created pump_fun_curve_snapshots table');
    
    // Create other necessary tables
    await db.schema.createTable('token_signals', (table) => {
      table.increments('id');
      table.string('token_address', 44);
      table.string('signal_type', 20);
      table.string('strategy', 50);
      table.decimal('confidence', 5, 4);
      table.string('strength', 20);
      table.jsonb('reasons');
      table.string('timeframe', 20);
      table.string('risk_level', 20);
      table.decimal('target_price', 30, 18);
      table.decimal('stop_loss', 30, 18);
      table.decimal('expected_return', 10, 6);
      table.timestamp('generated_at').defaultTo(db.fn.now());
      table.timestamp('expires_at');
      table.string('status', 20).defaultTo('ACTIVE');
    });
    console.log('✓ Created token_signals table');
    
    await db.schema.createTable('discovery_settings', (table) => {
      table.increments('id');
      table.string('setting_key', 100).unique();
      table.jsonb('setting_value');
      table.string('description', 255);
      table.timestamp('updated_at').defaultTo(db.fn.now());
    });
    console.log('✓ Created discovery_settings table');
    
    await db.schema.createTable('filtered_tokens', (table) => {
      table.increments('id');
      table.string('token_address', 44);
      table.string('filter_reason', 100);
      table.timestamp('filtered_at').defaultTo(db.fn.now());
    });
    console.log('✓ Created filtered_tokens table');
    
    await db.schema.createTable('creator_profiles', (table) => {
      table.string('creator_address', 44).primary();
      table.integer('tokens_created').defaultTo(0);
      table.integer('successful_tokens').defaultTo(0);
      table.integer('rug_pulls').defaultTo(0);
      table.decimal('avg_token_performance', 10, 6);
      table.decimal('reputation_score', 5, 4);
      table.timestamp('first_seen').defaultTo(db.fn.now());
      table.timestamp('last_activity').defaultTo(db.fn.now());
    });
    console.log('✓ Created creator_profiles table');
    
    await db.schema.createTable('pump_fun_events', (table) => {
      table.increments('id');
      table.string('signature', 88).unique();
      table.string('token_address', 44);
      table.string('event_type', 50);
      table.jsonb('event_data');
      table.timestamp('block_time');
      table.bigInteger('slot');
      table.timestamp('processed_at').defaultTo(db.fn.now());
    });
    console.log('✓ Created pump_fun_events table');
    
    await db.schema.createTable('token_analysis_history', (table) => {
      table.increments('id');
      table.string('token_address', 44);
      table.timestamp('analyzed_at').defaultTo(db.fn.now());
      table.jsonb('holders_data');
      table.jsonb('security_data');
      table.jsonb('liquidity_data');
      table.jsonb('trading_data');
      table.decimal('safety_score', 5, 4);
      table.decimal('potential_score', 5, 4);
      table.decimal('composite_score', 5, 4);
    });
    console.log('✓ Created token_analysis_history table');
    
    console.log('\n✅ Database setup complete!');
    
  } catch (error) {
    console.error('Error setting up database:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

setupDatabase();
