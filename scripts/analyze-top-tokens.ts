import { db } from '../src/database/postgres';
import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { categoryManager } from '../src/category/category-manager';
import { scanScheduler } from '../src/category/scan-scheduler';
import { tokenEnrichmentService } from '../src/analysis/token-enrichment-service';

async function analyzeTopTokens() {
  console.log('=== Analyzing Top Tokens ===\n');
  
  // 1. Start enrichment service if not running
  const enrichmentStats = await tokenEnrichmentService.getStats();
  if (!enrichmentStats.isRunning) {
    console.log('Starting Token Enrichment Service...');
    await tokenEnrichmentService.start();
    console.log('✅ Started\n');
  }
  
  // 2. Get HIGH and MEDIUM tokens
  const topTokens = await db('tokens')
    .whereIn('category', ['HIGH', 'MEDIUM'])
    .select('address', 'symbol', 'category', 'market_cap')
    .orderBy('market_cap', 'desc');
  
  console.log(`Found ${topTokens.length} HIGH/MEDIUM tokens to analyze\n`);
  
  // 3. Analyze each token
  for (const token of topTokens) {
    console.log(`\nAnalyzing ${token.symbol} (${token.category})...`);
    console.log(`  Current market cap: $${token.market_cap}`);
    
    try {
      // Create state machine if doesn't exist
      await categoryManager.createOrRestoreStateMachine(
        token.address,
        token.category,
        {
          currentMarketCap: Number(token.market_cap) || 0,
          scanCount: 0
        }
      );
      
      // Perform analysis
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        token.category,
        false // basic analysis for non-AIM
      );
      
      console.log('  Updated data:');
      console.log(`    Market Cap: $${result.marketCap}`);
      console.log(`    Liquidity: $${result.liquidity}`);
      console.log(`    Price: $${result.price}`);
      console.log(`    Volume 24h: $${result.volume24h}`);
      console.log(`    Holders: ${result.holders || 'N/A'}`);
      console.log(`    APIs used: ${result.apisUsed.join(', ')}`);
      
      // Update market cap in category manager
      if (result.marketCap > 0) {
        await categoryManager.updateTokenMarketCap(token.address, result.marketCap);
        
        // Check if category changed
        const newToken = await db('tokens').where('address', token.address).first();
        if (newToken.category !== token.category) {
          console.log(`  🔄 Category changed: ${token.category} → ${newToken.category}`);
          
          if (newToken.category === 'AIM') {
            console.log('  🎯 TOKEN ENTERED AIM ZONE!');
          }
        }
      }
      
      // Schedule for regular scanning
      const currentCategory = (await db('tokens').where('address', token.address).first()).category;
      await scanScheduler.scheduleToken(token.address, currentCategory);
      console.log(`  ✅ Scheduled for ${currentCategory} scanning`);
      
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
  }
  
  // 4. Show final status
  console.log('\n\n=== Final Status ===\n');
  
  const distribution = await db('tokens')
    .whereIn('category', ['HIGH', 'AIM'])
    .select('category')
    .count('* as count')
    .groupBy('category');
  
  console.table(distribution);
  
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('symbol', 'market_cap', 'liquidity', 'holders');
  
  if (aimTokens.length > 0) {
    console.log('\n🎯 TOKENS IN AIM:');
    aimTokens.forEach(t => {
      console.log(`  ${t.symbol}: $${t.market_cap} (Liq: $${t.liquidity}, Holders: ${t.holders || 'N/A'})`);
    });
  }
  
  // Show scheduler stats
  const scanStats = scanScheduler.getStats();
  console.log('\n\nScheduler Status:');
  Object.entries(scanStats).forEach(([cat, stats]: [string, any]) => {
    if (stats.totalTasks > 0) {
      console.log(`  ${cat}: ${stats.totalTasks} tasks`);
    }
  });
}

analyzeTopTokens()
  .then(() => {
    console.log('\n✅ Analysis complete!');
    setTimeout(() => process.exit(0), 2000);
  })
  .catch(console.error);