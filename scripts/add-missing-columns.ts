import { db } from '../src/database/postgres';

async function addMissingColumns() {
  console.log('🔧 Adding missing columns...\n');
  
  try {
    // Add current_price as alias for price
    await db.schema.alterTable('tokens', (table) => {
      table.decimal('current_price', 30, 18);
      table.timestamp('discovered_at').defaultTo(db.fn.now());
      table.jsonb('raw_data');
    });
    
    console.log('✅ Added missing columns');
    
    // Copy existing price data to current_price
    await db.raw('UPDATE tokens SET current_price = price WHERE current_price IS NULL');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

addMissingColumns();
