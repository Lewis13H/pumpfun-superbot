import { db } from '../src/database/postgres';

async function addPriceChangeColumn() {
  console.log('🔧 Adding price_change_24h column...\n');
  
  try {
    await db.schema.alterTable('tokens', (table) => {
      table.decimal('price_change_24h', 10, 2);
    });
    
    console.log('✅ Added price_change_24h column');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

addPriceChangeColumn();
