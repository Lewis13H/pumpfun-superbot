import { db } from '../src/database/postgres';

async function checkColumnType() {
  const result = await db.raw(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'discovery_settings' 
    AND column_name = 'setting_value'
  `);
  
  console.log('Column type:', result.rows[0]);
  
  await db.destroy();
}

checkColumnType();
