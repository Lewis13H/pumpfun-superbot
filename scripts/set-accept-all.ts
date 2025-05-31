import { db } from '../src/database/postgres';

async function setAcceptAllFilter() {
  console.log('🔧 Setting Accept All Filter...\n');
  
  try {
    await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .update({
        setting_value: JSON.stringify({
          name: 'accept_all',
          updatedAt: new Date()
        }),
        updated_at: new Date()
      });
    
    console.log('✅ Active filter set to: accept_all');
    console.log('⚠️  This will accept ALL tokens - use for testing only!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

setAcceptAllFilter();
