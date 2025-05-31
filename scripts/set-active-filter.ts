import { db } from '../src/database/postgres';

async function setActiveFilter() {
  console.log('🔧 Setting Active Filter...\n');
  
  try {
    // Set the active filter
    await db('discovery_settings')
      .insert({
        setting_key: 'active_filter',
        setting_value: JSON.stringify({
          name: 'default',  // or 'moderate'
          updatedAt: new Date()
        }),
        description: 'Currently active filter',
        updated_at: new Date()
      })
      .onConflict('setting_key')
      .merge();
    
    console.log('✅ Active filter set to: default');
    
    // Show all settings
    const allSettings = await db('discovery_settings').select('*');
    console.log('\n📊 All settings:');
    allSettings.forEach((s: any) => {
      console.log(`  ${s.setting_key}: ${s.setting_value}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

setActiveFilter();
