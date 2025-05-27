import { db } from '../src/database/postgres';

async function checkTokenStatus() {
  console.log('\n📊 Token Database Status\n');

  // Overall statistics
  const totalTokens = await db('tokens').count('* as count').first();
  console.log(`Total Tokens: ${totalTokens?.count || 0}\n`);

  // Analysis status breakdown
  console.log('Analysis Status:');
  const statusStats = await db('tokens')
    .select('analysis_status')
    .select(db.raw('count(*) as count'))
    .groupBy('analysis_status')
    .orderBy('count', 'desc');

  for (const stat of statusStats) {
    console.log(`  ${stat.analysis_status || 'NULL'}: ${stat.count}`);
  }

  // Classification breakdown
  console.log('\nInvestment Classifications:');
  const classStats = await db('tokens')
    .select('investment_classification')
    .select(db.raw('count(*) as count'))
    .whereNotNull('investment_classification')
    .groupBy('investment_classification')
    .orderBy('count', 'desc');

  for (const stat of classStats) {
    console.log(`  ${stat.investment_classification}: ${stat.count}`);
  }

  // Recent high-scoring tokens
  console.log('\n🚀 Top Scoring Tokens:');
  const topTokens = await db('tokens')
    .select('symbol', 'name', 'composite_score', 'investment_classification', 'price')
    .whereNotNull('composite_score')
    .where('composite_score', '>', 0.6)
    .orderBy('composite_score', 'desc')
    .limit(5);

  if (topTokens.length === 0) {
    console.log('  No high-scoring tokens found');
  } else {
    for (const token of topTokens) {
      const score = (token.composite_score * 100).toFixed(1);
      console.log(`  ${token.symbol || 'Unknown'}: ${score}% - ${token.investment_classification}`);
      if (token.price > 0) {
        console.log(`    Price: ${typeof token.price === 'number' ? token.price.toFixed(8) : token.price}`);
      }
    }
  }

  // Tokens with API data
  console.log('\n💰 Tokens with Price Data:');
  const priceCount = await db('tokens')
    .where('price', '>', 0)
    .count('* as count')
    .first();
  console.log(`  ${priceCount?.count || 0} tokens have price data`);

  console.log('\n✅ Status check complete!\n');
}

// Run check
checkTokenStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Status check failed:', error);
    process.exit(1);
  });