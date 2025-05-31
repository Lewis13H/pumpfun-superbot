import { db } from '../src/database/postgres';

async function checkTableStructure() {
  try {
    console.log('=== Discovery Settings Table Structure ===\n');
    
    // Get column information
    const columns = await db.raw(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'discovery_settings'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns:');
    columns.rows.forEach((col: any) => {
      console.log(`  ${col.column_name} - ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
    
    // Get actual data
    console.log('\nCurrent settings:');
    const settings = await db('discovery_settings').select('*');
    
    if (settings.length === 0) {
      console.log('No filter settings found. Need to insert default settings.');
    } else {
      console.log(settings);
    }
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkTableStructure();
