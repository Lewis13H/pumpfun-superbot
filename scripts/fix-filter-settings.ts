import { db } from '../src/database/postgres';

async function fixFilterSettings() {
  console.log('🔧 Fixing Filter Settings...\n');
  
  try {
    // Delete the corrupted setting
    await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .delete();
    
    // Insert correct setting
    await db('discovery_settings')
      .insert({
        setting_key: 'active_filter',
        setting_value: JSON.stringify({
          name: 'accept_all',
          updatedAt: new Date().toISOString()
        }),
        description: 'Currently active filter',
        updated_at: new Date()
      });
    
    console.log('✅ Fixed active_filter setting');
    
    // Verify all settings
    const settings = await db('discovery_settings').select('*');
    console.log('\n📊 All settings:');
    settings.forEach((s: any) => {
      console.log(`${s.setting_key}: ${s.setting_value}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

fixFilterSettings();
