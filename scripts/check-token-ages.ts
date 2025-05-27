import { db } from '../src/database/postgres';

async function checkTokenAges() {
  console.log('\n📊 Token Age Distribution\n');

  // Get age distribution of pending tokens
  const pendingTokens = await db('tokens')
    .select('address', 'symbol', 'created_at')
    .where('analysis_status', 'PENDING')
    .orderBy('created_at', 'asc');

  const ageBuckets = {
    'Less than 10 minutes': 0,
    '10-30 minutes': 0,
    '30-60 minutes': 0,
    '1-6 hours': 0,
    '6-24 hours': 0,
    'More than 24 hours': 0
  };

  const oldestTokens = [];

  for (const token of pendingTokens) {
    const ageMs = Date.now() - new Date(token.created_at).getTime();
    const ageMinutes = ageMs / 60000;
    const ageHours = ageMinutes / 60;

    if (ageMinutes < 10) ageBuckets['Less than 10 minutes']++;
    else if (ageMinutes < 30) ageBuckets['10-30 minutes']++;
    else if (ageMinutes < 60) ageBuckets['30-60 minutes']++;
    else if (ageHours < 6) ageBuckets['1-6 hours']++;
    else if (ageHours < 24) ageBuckets['6-24 hours']++;
    else ageBuckets['More than 24 hours']++;

    // Track oldest tokens
    if (ageHours > 1 && oldestTokens.length < 10) {
      oldestTokens.push({
        symbol: token.symbol || token.address.slice(0, 8),
        address: token.address,
        ageHours: Math.round(ageHours)
      });
    }
  }

  console.log('Age Distribution of PENDING tokens:');
  for (const [bucket, count] of Object.entries(ageBuckets)) {
    if (count > 0) {
      console.log(`  ${bucket}: ${count} tokens`);
    }
  }

  if (oldestTokens.length > 0) {
    console.log('\n🕰️ 10 Oldest PENDING tokens (good candidates for DEX listing):');
    for (const token of oldestTokens) {
      console.log(`  ${token.symbol} - ${token.ageHours} hours old`);
      console.log(`    Address: ${token.address}`);
    }
  }

  // Also check completed tokens with no price
  const completedNoPriceCount = await db('tokens')
    .where('analysis_status', 'COMPLETED')
    .where(function() {
      this.where('price', 0).orWhereNull('price');
    })
    .count('* as count')
    .first();

  console.log(`\n📈 Tokens analyzed but without price data: ${completedNoPriceCount?.count || 0}`);
  console.log('   (These were likely not on DEXes when analyzed)\n');
}

checkTokenAges()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });