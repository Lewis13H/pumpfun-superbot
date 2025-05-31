import { db } from '../src/database/postgres';

async function addDecimalsColumn() {
  try {
    console.log('Adding decimals column to tokens table...');
    
    await db.schema.alterTable('tokens', (table) => {
      table.integer('decimals').defaultTo(6);
    });
    
    console.log('✅ Decimals column added successfully');
    await db.destroy();
  } catch (error: any) {
    if (error.code === '42701') {
      console.log('Column already exists');
    } else {
      console.error('Error:', error);
    }
    await db.destroy();
  }
}

addDecimalsColumn();
