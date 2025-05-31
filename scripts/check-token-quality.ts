import { db } from '../src/database/postgres';

async function checkTokenQuality() {
  try {
    console.log('=== TOKEN QUALITY ANALYSIS ===\n');
    
    // Get recent analyzed tokens
    const analyzedTokens = await db('tokens')
      .where('analysis_status', 'COMPLETED')
      .whereNotNull('composite_score')
      .orderBy('created_at', 'desc')
      .limit(10);
    
    console.log('Recent analyzed tokens:');
    analyzedTokens.forEach(token => {
      console.log(`\n${token.symbol} (${token.address.substring(0,8)}...)`);
      console.log(`  Market Cap: $${token.market_cap}`);
      console.log(`  Safety Score: ${token.safety_score}`);
      console.log(`  Potential Score: ${token.potential_score}`);
      console.log(`  Composite Score: ${token.composite_score}`);
      console.log(`  Classification: ${token.investment_classification || 'N/A'}`);
      console.log(`  Tier: ${token.analysis_tier || 'N/A'}`);
    });
    
    // Score distribution
    const scoreDistribution = await db.raw(`
      SELECT 
        CASE 
          WHEN composite_score >= 0.7 THEN 'High (>0.7)'
          WHEN composite_score >= 0.5 THEN 'Medium (0.5-0.7)'
          WHEN composite_score >= 0.3 THEN 'Low (0.3-0.5)'
          ELSE 'Very Low (<0.3)'
        END as score_range,
        COUNT(*) as count
      FROM tokens
      WHERE composite_score IS NOT NULL
      GROUP BY score_range
      ORDER BY score_range DESC
    `);
    
    console.log('\nComposite score distribution:');
    scoreDistribution.rows.forEach((r: any) => {
      console.log(`  ${r.score_range}: ${r.count} tokens`);
    });
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkTokenQuality();
