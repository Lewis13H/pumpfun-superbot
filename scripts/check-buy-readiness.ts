import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

interface BuyCriteria {
  minLiquidity: number;
  minHolders: number;
  maxTop10Concentration: number;
  minSolsnifferScore: number;
  blacklistedSolsnifferScore: number;
}

const buyCriteria: BuyCriteria = {
  minLiquidity: 7500,
  minHolders: 50,
  maxTop10Concentration: 25,
  minSolsnifferScore: 60,
  blacklistedSolsnifferScore: 90
};

async function checkBuyReadiness() {
  console.log('=== Buy Signal Readiness Check ===\n');
  console.log('Buy Criteria:');
  console.log(`- Market Cap: $35k-$105k (AIM category)`);
  console.log(`- Liquidity: ≥$${buyCriteria.minLiquidity}`);
  console.log(`- Holders: ≥${buyCriteria.minHolders}`);
  console.log(`- Top 10 Concentration: <${buyCriteria.maxTop10Concentration}%`);
  console.log(`- SolSniffer Score: >${buyCriteria.minSolsnifferScore} and ≠${buyCriteria.blacklistedSolsnifferScore}`);
  console.log('\n');

  // Get all AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('*')
    .orderBy('market_cap', 'desc');

  console.log(`Found ${aimTokens.length} tokens in AIM category\n`);

  for (const token of aimTokens) {
    console.log(`\n=== ${token.symbol} (${token.address.substring(0, 8)}...) ===`);
    console.log(`Market Cap: $${parseFloat(token.market_cap).toFixed(2)}`);
    
    const criteria = {
      marketCap: true, // Already in AIM
      liquidity: token.liquidity >= buyCriteria.minLiquidity,
      holders: token.holders >= buyCriteria.minHolders,
      top10: token.top_10_percent !== null ? token.top_10_percent < buyCriteria.maxTop10Concentration : null,
      solsniffer: token.solsniffer_score !== null ? 
        (token.solsniffer_score > buyCriteria.minSolsnifferScore && 
         token.solsniffer_score !== buyCriteria.blacklistedSolsnifferScore) : null
    };

    console.log('\nCriteria Check:');
    console.log(`✓ Market Cap: In AIM range`);
    console.log(`${criteria.liquidity ? '✓' : '✗'} Liquidity: $${parseFloat(token.liquidity).toFixed(2)} (need ≥$${buyCriteria.minLiquidity})`);
    console.log(`${criteria.holders ? '✓' : '✗'} Holders: ${token.holders || 'N/A'} (need ≥${buyCriteria.minHolders})`);
    
    if (criteria.top10 !== null) {
      console.log(`${criteria.top10 ? '✓' : '✗'} Top 10 Concentration: ${token.top_10_percent}% (need <${buyCriteria.maxTop10Concentration}%)`);
    } else {
      console.log(`? Top 10 Concentration: Not checked`);
    }
    
    if (criteria.solsniffer !== null) {
      console.log(`${criteria.solsniffer ? '✓' : '✗'} SolSniffer Score: ${token.solsniffer_score} (need >${buyCriteria.minSolsnifferScore} and ≠${buyCriteria.blacklistedSolsnifferScore})`);
    } else {
      console.log(`? SolSniffer Score: Not checked (out of credits)`);
    }

    // Calculate readiness
    const passedCriteria = Object.values(criteria).filter(v => v === true).length;
    const totalCriteria = Object.values(criteria).filter(v => v !== null).length;
    
    console.log(`\nReadiness: ${passedCriteria}/${totalCriteria} criteria passed`);
    
    if (passedCriteria === totalCriteria && totalCriteria >= 3) {
      console.log('🚀 READY FOR BUY SIGNAL (excluding SolSniffer)');
    } else {
      console.log('❌ Not ready for buy signal');
    }
  }

  // Check tokens close to AIM
  console.log('\n\n=== Tokens Close to AIM Category ===');
  const nearAimTokens = await db('tokens')
    .where('category', 'HIGH')
    .where('market_cap', '>', 30000)
    .select('symbol', 'market_cap', 'liquidity', 'holders')
    .orderBy('market_cap', 'desc')
    .limit(5);

  if (nearAimTokens.length > 0) {
    console.log('\nHIGH category tokens approaching AIM ($35k):');
    for (const token of nearAimTokens) {
      console.log(`- ${token.symbol}: $${parseFloat(token.market_cap).toFixed(2)} (needs $${(35000 - parseFloat(token.market_cap)).toFixed(2)} more)`);
    }
  }

  process.exit(0);
}

checkBuyReadiness().catch(console.error);
