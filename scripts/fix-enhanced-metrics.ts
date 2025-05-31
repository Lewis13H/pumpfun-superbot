import { db } from '../src/database/postgres';

async function fixEnhancedMetrics() {
  console.log('🔧 Adding missing columns to enhanced_token_metrics...\n');
  
  try {
    await db.schema.alterTable('enhanced_token_metrics', (table) => {
      table.integer('holder_count');
      table.decimal('price_change_24h', 10, 2);
    });
    
    console.log('✅ Added missing columns');
    
  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      console.log('⚠️  Columns already exist');
    } else {
      console.error('Error:', error);
    }
  } finally {
    await db.destroy();
  }
}

fixEnhancedMetrics();
