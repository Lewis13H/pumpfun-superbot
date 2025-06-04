import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { db } from '../src/database/postgres';

async function rescanTokens() {
  console.log('Re-scanning tokens with fixed liquidity parsing...\n');
  
  // Get tokens that need liquidity data
  const tokens = await db('tokens')
    .where('liquidity', 0)
    .andWhere('market_cap', '>', 10000)
    .select('address', 'symbol', 'category')
    .limit(5);
  
  console.log(`Found ${tokens.length} tokens to re-scan\n`);
  
  for (const token of tokens) {
    console.log(`\nScanning ${token.symbol} (${token.address})...`);
    
    try {
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        token.category,
        false
      );
      
      console.log(`✓ ${token.symbol}:`, {
        marketCap: result.marketCap,
        liquidity: result.liquidity,
        volume24h: result.volume24h
      });
      
      // Wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`✗ ${token.symbol} failed:`, error);
    }
  }
  
  console.log('\n\nChecking database for updated values...');
  const updated = await db('tokens')
    .whereIn('address', tokens.map(t => t.address))
    .select('symbol', 'liquidity');
  
  console.log('Updated values:', updated);
  process.exit(0);
}

rescanTokens().catch(console.error);
