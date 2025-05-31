import { db } from '../src/database/postgres';

async function checkCurrentFilter() {
  try {
    console.log('=== CURRENT FILTER SETTINGS ===\n');
    
    // Get all settings
    const allSettings = await db('discovery_settings')
      .select('*')
      .orderBy('updated_at', 'desc');
    
    console.log('Discovery settings:');
    allSettings.forEach(s => {
      if (s.setting_key === 'active_filter' || s.setting_key === 'bypass_filter') {
        console.log(`\n${s.setting_key}:`);
        console.log(`  Value: ${JSON.stringify(s.setting_value)}`);
        console.log(`  Updated: ${new Date(s.updated_at).toLocaleString()}`);
      }
    });
    
    // Force update to moderate filter
    console.log('\nUpdating to moderate filter...');
    
    const result = await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .update({
        setting_value: { name: 'moderate', updatedAt: new Date() },
        updated_at: new Date()
      });
    
    console.log(`Updated ${result} rows`);
    
    // Disable bypass
    await db('discovery_settings')
      .where('setting_key', 'bypass_filter')
      .update({
        setting_value: false,
        updated_at: new Date()
      });
    
    console.log('Disabled bypass_filter');
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkCurrentFilter();
