const { db } = require('./src/database/postgres');

async function checkFilterSettings() {
  console.log('🔍 Current Filter Settings:\n');
  
  // Check discovery_settings table
  const settings = await db('discovery_settings').where('active', true).first();
  if (settings) {
    console.log('Active Filter:', settings);
  }
  
  // Check filtered tokens to see why they're being rejected
  const recentFiltered = await db('filtered_tokens')
    .orderBy('discovered_at', 'desc')
    .limit(10);
    
  console.log('\n📊 Recent Filter Reasons:');
  const reasons = {};
  recentFiltered.forEach(t => {
    reasons[t.filter_reason] = (reasons[t.filter_reason] || 0) + 1;
  });
  console.log(reasons);
  
  // Check token stats
  const stats = await db('tokens').count('* as total');
  console.log('\n📈 Token Stats:');
  console.log('Total tokens in DB:', stats[0].total);
  
  await db.destroy();
}

checkFilterSettings();
