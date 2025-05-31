import { db } from '../src/database/postgres';

async function updateToQualityFilter() {
  try {
    console.log('Updating to quality_new filter...\n');
    
    // Update to quality_new filter
    const result = await db('discovery_settings')
      .where('setting_key', 'active_filter')
      .update({
        setting_value: { name: 'quality_new', updatedAt: new Date() },
        updated_at: new Date()
      });
    
    console.log(`✅ Updated to quality_new filter`);
    
    // Show what this means
    console.log('\nWith quality_new filter, tokens must have:');
    console.log('  - Market Cap >= $5,000');
    console.log('  - Liquidity >= $2,000'); 
    console.log('  - Volume 24h >= $1,000 (if available)');
    console.log('  - Proper token name');
    console.log('  - DexScreener listing is NOT required');
    console.log('\nThis allows discovering PumpFun tokens before they hit DexScreener!');
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

updateToQualityFilter();
