import { db } from '../src/database/postgres';

async function enableFilterBypass() {
  console.log('🔧 Enabling Filter Bypass...\n');
  
  try {
    await db('discovery_settings')
      .insert({
        setting_key: 'bypass_filter',
        setting_value: 'true',
        description: 'Temporarily bypass all filters',
        updated_at: new Date()
      })
      .onConflict('setting_key')
      .merge();
    
    console.log('✅ Filter bypass enabled!');
    console.log('⚠️  WARNING: All tokens will be saved regardless of quality');
    console.log('📌 Remember to disable this after testing');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

enableFilterBypass();
