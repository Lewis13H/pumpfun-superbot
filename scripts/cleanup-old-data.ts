import { db } from '../src/database/postgres';

async function cleanupOldData() {
  console.log('\n🧹 Cleaning up old data...\n');

  // Get tokens with invalid classifications
  const invalidTokens = await db('tokens')
    .select('address', 'symbol', 'investment_classification')
    .where('investment_classification', 'MODERATE')
    .orWhere('investment_classification', 'NOT_ANALYZED');

  console.log(`Found ${invalidTokens.length} tokens with invalid classifications\n`);

  if (invalidTokens.length > 0) {
    // Reset these tokens to be re-analyzed
    const updated = await db('tokens')
      .whereIn('investment_classification', ['MODERATE', 'NOT_ANALYZED'])
      .update({
        analysis_status: 'PENDING',
        investment_classification: null,
        composite_score: null,
        safety_score: null,
        potential_score: null,
        price: null,
        market_cap: null,
        volume_24h: null,
        liquidity: null,
        updated_at: new Date()
      });

    console.log(`✅ Reset ${updated} tokens for re-analysis\n`);
  }

  // Show current token statistics
  const stats = await db('tokens')
    .select('analysis_status')
    .select(db.raw('count(*) as count'))
    .groupBy('analysis_status');

  console.log('📊 Token Statistics:');
  for (const stat of stats) {
    console.log(`   ${stat.analysis_status || 'NULL'}: ${stat.count} tokens`);
  }

  console.log('\n✅ Cleanup complete!\n');
}

// Run cleanup
cleanupOldData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  });