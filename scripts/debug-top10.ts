import { HeliusClient } from '../src/api/helius-client';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function debugTop10() {
  const helius = new HeliusClient(config.apis.heliusRpcUrl);
  
  // Test with SIREN token
  const tokenAddress = '8Ejjia4XQJNM6K4UiQjSjtmLKJ9dGwxay91QLNULQ1q6';
  
  console.log('Debugging Top 10 Concentration for SIREN...\n');
  
  try {
    // Get top 10 holders
    const holders = await helius.getTokenHolders(tokenAddress, 10);
    console.log(`Found ${holders?.length || 0} top holders`);
    
    // Get total supply
    const totalSupply = await helius.getTokenSupply(tokenAddress);
    console.log(`Total supply: ${totalSupply}`);
    
    if (holders && holders.length > 0 && totalSupply > 0) {
      // Show each holder
      console.log('\nTop holders:');
      holders.forEach((h: any, i: number) => {
        const percentage = (h.amount / totalSupply * 100).toFixed(2);
        console.log(`${i + 1}. ${h.owner}: ${h.amount} tokens (${percentage}%)`);
      });
      
      // Calculate top 10 total
      const top10Amount = holders.reduce((sum: number, h: any) => sum + (h.amount || 0), 0);
      const concentration = (top10Amount / totalSupply) * 100;
      
      console.log(`\nTop 10 total: ${top10Amount} tokens`);
      console.log(`Concentration: ${concentration.toFixed(2)}%`);
      
      // Check if it's a calculation issue
      if (concentration > 100) {
        console.log('\n⚠️  Concentration > 100% indicates a calculation error');
        console.log('Possible issues:');
        console.log('- Token decimals not accounted for');
        console.log('- Supply calculation incorrect');
      }
    }
    
    // Check database value
    const dbToken = await db('tokens')
      .where('address', tokenAddress)
      .select('top_10_percent', 'holders')
      .first();
    
    console.log('\nDatabase values:');
    console.log(`top_10_percent: ${dbToken.top_10_percent}`);
    console.log(`holders: ${dbToken.holders}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

debugTop10().catch(console.error);
