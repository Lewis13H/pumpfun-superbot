import { db } from '../src/database/postgres';

async function checkRawValue() {
  console.log('🔍 Checking Raw Database Value...\n');
  
  try {
    const result = await db.raw(`
      SELECT setting_key, setting_value, pg_typeof(setting_value) as value_type
      FROM discovery_settings 
      WHERE setting_key = 'active_filter'
    `);
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log('Key:', row.setting_key);
      console.log('Value:', row.setting_value);
      console.log('Type:', row.value_type);
      console.log('Length:', row.setting_value.length);
      
      // Try to see what's in it
      if (row.setting_value === '[object Object]') {
        console.log('\n❌ Value is literally "[object Object]" string');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

checkRawValue();
