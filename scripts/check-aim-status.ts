import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';

async function checkAimStatus() {
  try {
    // Get category distribution
    const dist = await categoryManager.getCategoryDistribution();
    console.log('Category Distribution:');
    console.table(dist);
    
    // Check HIGH tokens close to AIM
    const nearAim = await db('tokens')
      .where('category', 'HIGH')
      .where('market_cap', '>', 25000)
      .select('symbol', 'address', 'market_cap', 'liquidity', 'holders')
      .orderBy('market_cap', 'desc')
      .limit(5);
    
    console.log('\nTokens approaching AIM threshold ($35k):');
    nearAim.forEach(token => {
      const progress = ((token.market_cap / 35000) * 100).toFixed(1);
      console.log(`  ${token.symbol}: $${token.market_cap} (${progress}% to AIM)`);
    });
    
    // Check if any AIM tokens exist
    const aimTokens = await db('tokens')
      .where('category', 'AIM')
      .select('symbol', 'market_cap');
    
    console.log(`\nTokens in AIM category: ${aimTokens.length}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

checkAimStatus();