const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function setupCategoryTrigger() {
  console.log('Setting up automatic category transition trigger...\n');
  
  // Create a trigger function to automatically update categories
  const triggerFunction = `
    CREATE OR REPLACE FUNCTION update_token_category() 
    RETURNS TRIGGER AS $$
    DECLARE
      new_category TEXT;
      old_category TEXT;
    BEGIN
      -- Store old category
      old_category := COALESCE(OLD.category, NEW.category);
      
      -- Determine new category based on market cap
      IF NEW.market_cap IS NULL OR NEW.market_cap = 0 THEN
        new_category := 'NEW';
      ELSIF NEW.market_cap < 8000 THEN
        new_category := 'LOW';
      ELSIF NEW.market_cap < 19000 THEN
        new_category := 'MEDIUM';
      ELSIF NEW.market_cap < 35000 THEN
        new_category := 'HIGH';
      ELSIF NEW.market_cap <= 145000 THEN
        new_category := 'AIM';
      ELSE
        new_category := 'ARCHIVE';
      END IF;
      
      -- Only update if category changed
      IF old_category != new_category THEN
        NEW.category := new_category;
        NEW.category_updated_at := NOW();
        NEW.category_scan_count := 0;
        
        -- Log the transition
        INSERT INTO category_transitions 
        (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
        VALUES (NEW.address, old_category, new_category, NEW.market_cap, 'Auto-transition on market cap update', NOW());
        
        RAISE NOTICE 'Token % moved from % to % (MC: $%)', 
          NEW.symbol, old_category, new_category, NEW.market_cap;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
  
  // Create the trigger
  const createTrigger = `
    DROP TRIGGER IF EXISTS auto_update_category ON tokens;
    
    CREATE TRIGGER auto_update_category
    BEFORE UPDATE OF market_cap ON tokens
    FOR EACH ROW
    WHEN (OLD.market_cap IS DISTINCT FROM NEW.market_cap)
    EXECUTE FUNCTION update_token_category();
  `;
  
  try {
    await pool.query(triggerFunction);
    console.log('✓ Created category update function');
    
    await pool.query(createTrigger);
    console.log('✓ Created automatic category trigger');
    
    // Test the trigger
    const testResult = await pool.query(`
      UPDATE tokens 
      SET market_cap = market_cap + 0.01 
      WHERE symbol = 'DWCWRWBWH' 
      RETURNING symbol, category, market_cap
    `);
    
    if (testResult.rows.length > 0) {
      console.log('\n✓ Trigger test successful:', testResult.rows[0]);
    }
    
  } catch (error) {
    console.error('Error setting up trigger:', error);
  } finally {
    await pool.end();
  }
}

setupCategoryTrigger().catch(console.error);