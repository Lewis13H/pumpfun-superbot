import { db } from '../src/database/postgres';

async function checkDiscoverySettings() {
  try {
    console.log('=== Discovery Filter Settings ===\n');
    
    // Get all filter settings
    const settings = await db('discovery_settings')
      .select('*')
      .orderBy('active', 'desc');
    
    console.log('Available filters:');
    settings.forEach(s => {
      console.log(`\n${s.filter_name} ${s.active ? '(ACTIVE)' : ''}`);
      console.log(`  Min Liquidity: $${s.min_liquidity}`);
      console.log(`  Min Market Cap: $${s.min_market_cap}`);
      console.log(`  Min Holders: ${s.min_holders}`);
      console.log(`  Max Holder %: ${s.max_holder_percentage}%`);
    });
    
    // Check current filter in use
    const activeFilter = settings.find(s => s.active);
    console.log(`\nCurrently using: ${activeFilter?.filter_name || 'unknown'} filter`);
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkDiscoverySettings();
