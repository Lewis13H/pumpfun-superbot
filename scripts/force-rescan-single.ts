import { TokenAnalyzer } from '../src/analysis/token-analyzer';
import { DatabaseService } from '../src/database/database-service';
import { config } from 'dotenv';

config();

async function forceRescan() {
  const tokenAddress = '7JQSGgM6JLqfHkyqWwxehge8hjNPgK4ZZHyQJPmpump';
  const db = DatabaseService.getInstance();
  const analyzer = new TokenAnalyzer();
  
  console.log('Current token data:');
  const currentData = await db.getToken(tokenAddress);
  console.log('Market Cap:', currentData?.market_cap);
  console.log('Last Updated:', currentData?.updated_at);
  
  console.log('\nForcing rescan...');
  const newData = await analyzer.analyze(tokenAddress);
  console.log('New Market Cap:', newData.marketCap);
  console.log('New Liquidity:', newData.liquidity);
  
  await db.updateToken(tokenAddress, {
    market_cap: newData.marketCap,
    liquidity: newData.liquidity,
    updated_at: new Date()
  });
  
  console.log('\nToken updated successfully');
  process.exit(0);
}

forceRescan().catch(console.error);
