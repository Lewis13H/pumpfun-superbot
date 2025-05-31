import { db } from '../src/database/postgres';

async function addGraduationTimeColumn() {
  try {
    console.log('Adding estimated_graduation_time column to tokens table...');
    
    await db.schema.alterTable('tokens', (table) => {
      table.decimal('estimated_graduation_time', 10, 2).nullable();
    });
    
    console.log('✅ Column added successfully');
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

addGraduationTimeColumn();
