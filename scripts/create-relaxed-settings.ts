import { db } from '../src/database/postgres';

async function createRelaxedSettings() {
  console.log('🔧 Creating Relaxed Filter Settings...\n');
  
  try {
    // Define relaxed settings
    const settings = [
      {
        setting_key: 'min_liquidity',
        setting_value: '1000',  // $1K instead of $10K
        description: 'Minimum liquidity in USD'
      },
      {
        setting_key: 'min_market_cap',
        setting_value: '1000',  // $1K instead of $5K
        description: 'Minimum market cap in USD'
      },
      {
        setting_key: 'min_holders',
        setting_value: '10',    // 10 instead of 50
        description: 'Minimum number of holders'
      },
      {
        setting_key: 'max_holder_concentration',
        setting_value: '0.9',   // 90% instead of 50%
        description: 'Maximum percentage one holder can have'
      },
      {
        setting_key: 'require_dexscreener',
        setting_value: 'false', // Don't require DEX listing
        description: 'Whether to require DexScreener listing'
      },
      {
        setting_key: 'min_age_seconds',
        setting_value: '30',    // 30 seconds instead of 60
        description: 'Minimum token age in seconds'
      },
      {
        setting_key: 'filter_enabled',
        setting_value: 'true',
        description: 'Whether filtering is enabled'
      }
    ];
    
    // Insert or update settings
    for (const setting of settings) {
      await db('discovery_settings')
        .insert({
          ...setting,
          updated_at: new Date()
        })
        .onConflict('setting_key')
        .merge();
    }
    
    console.log('✅ Settings created successfully!');
    
    // Display all settings
    const allSettings = await db('discovery_settings').select('*');
    console.log('\n📊 All settings:');
    allSettings.forEach((s: any) => {
      console.log(`  ${s.setting_key}: ${s.setting_value} (${s.description})`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

createRelaxedSettings();
