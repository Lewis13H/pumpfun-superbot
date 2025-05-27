import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function showTokens() {
  // Get recent tokens with scores
  const tokens = await db('tokens')
    .whereNotNull('composite_score')
    .orderBy('composite_score', 'desc')
    .limit(10)
    .select('symbol', 'name', 'address', 'platform', 'composite_score', 
            'investment_classification', 'analysis_status', 'created_at');
    
  console.log('\nTop Scored Tokens:');
  console.table(tokens.map(t => ({
    Symbol: t.symbol.substring(0, 10),
    Score: t.composite_score,
    Class: t.investment_classification,
    Status: t.analysis_status,
    Age: `${Math.floor((Date.now() - new Date(t.created_at).getTime()) / 3600000)}h ago`
  })));
  
  // Get token address examples
  console.log('\nExample token addresses:');
  tokens.slice(0, 3).forEach(t => {
    console.log(`${t.symbol}: ${t.address}`);
  });
  
  process.exit(0);
}

showTokens().catch(console.error);