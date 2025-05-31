import { db } from '../src/database/postgres';

async function forceUpdateFilter() {
  console.log('🔧 Force Updating Filter...\n');
  
  try {
    // First delete the bad record
    await db.raw(`DELETE FROM discovery_settings WHERE setting_key = 'active_filter'`);
    
    // Insert with proper JSON
    const properJson = JSON.stringify({
      name: 'accept_all',
      updatedAt: new Date().toISOString()
    });
    
    console.log('Inserting JSON:', properJson);
    
    await db.raw(`
      INSERT INTO discovery_settings (setting_key, setting_value, description, updated_at)
      VALUES (?, ?, ?, NOW())
    `, ['active_filter', properJson, 'Currently active filter']);
    
    // Verify it worked
    const check = await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .first();
    
    console.log('\n✅ Verification:');
    console.log('Stored value:', check.setting_value);
    
    try {
      const parsed = JSON.parse(check.setting_value);
      console.log('Parsed successfully:', parsed);
      console.log('Filter name:', parsed.name);
    } catch (e) {
      console.log('❌ Failed to parse:', e.message);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

forceUpdateFilter();
