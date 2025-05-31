import { db } from '../src/database/postgres';

async function fixAnalysisHistoryTable() {
  try {
    console.log('Adding missing columns to token_analysis_history table...');
    
    await db.schema.alterTable('token_analysis_history', (table) => {
      table.string('ml_classification', 50);
      table.decimal('ml_confidence', 5, 4);
    });
    
    console.log('✅ Columns added successfully');
    await db.destroy();
  } catch (error: any) {
    if (error.code === '42701') {
      console.log('Columns already exist');
    } else {
      console.error('Error:', error);
    }
    await db.destroy();
  }
}

fixAnalysisHistoryTable();
