import { db } from '../src/database/postgres';

async function setMostRelaxedFilter() {
  console.log('🔧 Setting Most Relaxed Filter...\n');
  
  try {
    // Set the active filter to new_with_traction (most relaxed)
    await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .update({
        setting_value: JSON.stringify({
          name: 'new_with_traction',  // Most relaxed filter
          updatedAt: new Date()
        }),
        updated_at: new Date()
      });
    
    console.log('✅ Active filter set to: new_with_traction');
    console.log('   - Min Liquidity: $50');
    console.log('   - No name requirement');
    console.log('   - No market cap requirement');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

setMostRelaxedFilter();
