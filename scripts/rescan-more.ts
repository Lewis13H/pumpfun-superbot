import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { db } from '../src/database/postgres';

async function rescanMore() {
  console.log('Rescanning next batch of tokens...\n');
  
  // Get next 100 tokens with 0 liquidity, prioritizing higher market caps
  const tokens = await db('tokens')
    .where('liquidity', 0)
    .whereNotNull('market_cap')
    .where('market_cap', '>', 1000)
    .select('address', 'symbol', 'category', 'market_cap')
    .orderBy('market_cap', 'desc')
    .limit(100);
  
  console.log(`Found ${tokens.length} tokens to rescan\n`);
  
  let successCount = 0;
  let processedCount = 0;
  
  for (const token of tokens) {
    processedCount++;
    process.stdout.write(`\rProcessing ${processedCount}/${tokens.length}...`);
    
    try {
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        token.category,
        false
      );
      
      if (result.liquidity > 0) {
        successCount++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error: any) {
      // Silent fail to keep progress going
    }
  }
  
  console.log(`\n\nRescan complete! ${successCount} new tokens with liquidity data`);
  
  // Show category distribution - fixed SQL
  const categoryStats = await db('tokens')
    .select('category')
    .count('* as total')
    .count(db.raw('CASE WHEN liquidity > 0 THEN 1 END as with_liquidity'))
    .groupBy('category')
    .orderBy('category');
  
  console.log('\nTokens with liquidity by category:');
  for (const stat of categoryStats) {
    const total = parseInt(stat.total as string);
    const withLiquidity = parseInt(stat.with_liquidity as string) || 0;
    const percentage = (withLiquidity / total * 100).toFixed(1);
    console.log(`${stat.category}: ${withLiquidity}/${total} (${percentage}%)`);
  }
  
  process.exit(0);
}

rescanMore().catch(console.error);
