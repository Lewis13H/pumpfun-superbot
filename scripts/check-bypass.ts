import { db } from '../src/database/postgres';

async function checkBypassAndModify() {
  // First, let's verify the bypass is set
  const bypass = await db('discovery_settings')
    .where('setting_key', 'bypass_filter')
    .first();
    
  console.log('Bypass setting:', bypass?.setting_value);
  
  if (bypass?.setting_value === 'true') {
    console.log('✅ Bypass is enabled');
    console.log('⚠️  Now you need to restart the discovery service for it to take effect');
  }
  
  await db.destroy();
}

checkBypassAndModify();
