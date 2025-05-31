import { db } from '../src/database/postgres';

async function addStatusColumn() {
  console.log('🔧 Adding status column...\n');
  
  try {
    await db.schema.alterTable('tokens', (table) => {
      table.string('status', 20).defaultTo('active');
    });
    
    console.log('✅ Added status column');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

addStatusColumn();
