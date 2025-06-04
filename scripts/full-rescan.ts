import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { db } from '../src/database/postgres';

async function fullRescan() {
  console.log('Starting full rescan of tokens with 0 liquidity...\n');
  
  // Get all tokens with 0 liquidity
  const tokens = await db('tokens')
    .where('liquidity', 0)
    .select('address', 'symbol', 'category')
    .orderBy('market_cap', 'desc')
    .limit(50); // Process 50 at a time
  
  console.log(`Found ${tokens.length} tokens to rescan\n`);
  
  let successCount = 0;
  
  for (const token of tokens) {
    try {
      console.log(`Scanning ${token.symbol}...`);
      
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        token.category,
        false // Don't force full analysis to avoid SolSniffer credits
      );
      
      if (result.liquidity > 0) {
        successCount++;
        console.log(`✓ ${token.symbol}: $${result.liquidity.toFixed(2)} liquidity`);
      } else {
        console.log(`✗ ${token.symbol}: Still no liquidity data`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      console.error(`✗ ${token.symbol} failed:`, error.message || error);
    }
  }
  
  console.log(`\n\nRescan complete! ${successCount}/${tokens.length} tokens now have liquidity data`);
  
  // Show summary
  const summary = await db('tokens')
    .select(
      db.raw('COUNT(*) as total_tokens'),
      db.raw('COUNT(CASE WHEN liquidity > 0 THEN 1 END) as tokens_with_liquidity'),
      db.raw('AVG(CASE WHEN liquidity > 0 THEN liquidity END) as avg_liquidity')
    )
    .first();
  
  console.log('\nDatabase Summary:');
  console.log(`Total tokens: ${summary.total_tokens}`);
  console.log(`Tokens with liquidity: ${summary.tokens_with_liquidity}`);
  console.log(`Average liquidity: $${parseFloat(summary.avg_liquidity || '0').toFixed(2)}`);
  
  process.exit(0);
}

fullRescan().catch(console.error);
