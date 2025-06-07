// scripts/monitor-grpc-flow.ts - Real-time monitoring of gRPC events
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

interface FlowStats {
  startTime: Date;
  tokensCreated: number;
  priceUpdatesReceived: number;
  priceUpdatesSaved: number;
  priceUpdatesSkipped: number;
  tokenAddresses: Set<string>;
  errors: number;
}

async function monitorGrpcFlow() {
  console.log('\n=== Monitoring gRPC Data Flow ===\n');
  
  const stats: FlowStats = {
    startTime: new Date(),
    tokensCreated: 0,
    priceUpdatesReceived: 0,
    priceUpdatesSaved: 0,
    priceUpdatesSkipped: 0,
    tokenAddresses: new Set(),
    errors: 0
  };
  
  // Initial counts
  const initialTokenCount = await db('tokens').count('* as count');
  const initialPriceCount = await db('timeseries.token_prices').count('* as count');
  
  const initialTokens = Number(initialTokenCount[0].count);
  const initialPrices = Number(initialPriceCount[0].count);
  
  console.log(`Starting counts - Tokens: ${initialTokens}, Prices: ${initialPrices}`);
  
  // Monitor for 30 seconds
  const monitorInterval = setInterval(async () => {
    try {
      // Get current counts
      const currentTokenCount = await db('tokens').count('* as count');
      const currentPriceCount = await db('timeseries.token_prices').count('* as count');
      
      const currentTokens = Number(currentTokenCount[0].count);
      const currentPrices = Number(currentPriceCount[0].count);
      
      const newTokens = currentTokens - initialTokens;
      const newPrices = currentPrices - initialPrices;
      
      // Get recent tokens
      const recentTokens = await db('tokens')
        .where('created_at', '>', stats.startTime)
        .select('address', 'symbol', 'bonding_curve', 'market_cap', 'last_price_update')
        .orderBy('created_at', 'desc')
        .limit(5);
      
      // Check which tokens have prices
      const tokensWithPrices = await db('timeseries.token_prices')
        .whereIn('token_address', recentTokens.map(t => t.address))
        .select('token_address')
        .distinct('token_address');
      
      const tokensWithPriceSet = new Set(tokensWithPrices.map(t => t.token_address));
      
      // Display status
      console.clear();
      console.log('=== gRPC Flow Monitor ===');
      console.log(`Running for: ${Math.floor((Date.now() - stats.startTime.getTime()) / 1000)}s`);
      console.log(`\nNew Tokens: ${newTokens}`);
      console.log(`New Price Records: ${newPrices}`);
      console.log(`\nRecent Tokens:`);
      
      recentTokens.forEach(token => {
        const hasPrices = tokensWithPriceSet.has(token.address);
        const priceStatus = hasPrices ? '✅' : '❌';
        const priceUpdate = token.last_price_update ? new Date(token.last_price_update).toLocaleTimeString() : 'Never';
        
        console.log(`${priceStatus} ${token.address.substring(0, 10)}... | ${token.symbol || 'UNKNOWN'} | BC: ${token.bonding_curve ? 'Yes' : 'No'} | MC: $${token.market_cap || 0} | Last Price: ${priceUpdate}`);
      });
      
      // Check for tokens without any prices
      const tokensWithoutPrices = await db('tokens')
        .whereNull('last_price_update')
        .where('created_at', '>', stats.startTime)
        .count('* as count');
      
      console.log(`\nTokens without any price updates: ${Number(tokensWithoutPrices[0].count)}`);
      
      // Sample price data flow
      const latestPrices = await db('timeseries.token_prices')
        .where('time', '>', stats.startTime)
        .orderBy('time', 'desc')
        .limit(5)
        .select('token_address', 'time', 'price_usd', 'market_cap');
      
      if (latestPrices.length > 0) {
        console.log('\nLatest Price Updates:');
        latestPrices.forEach(price => {
          console.log(`${new Date(price.time).toLocaleTimeString()} - ${price.token_address.substring(0, 10)}... - $${parseFloat(price.price_usd).toFixed(6)}`);
        });
      }
      
    } catch (error) {
      console.error('Monitor error:', error);
      stats.errors++;
    }
  }, 2000); // Update every 2 seconds
  
  // Stop after 60 seconds
  setTimeout(async () => {
    clearInterval(monitorInterval);
    
    console.log('\n\n=== Final Report ===');
    
    // Final analysis
    const finalTokenCount = await db('tokens').count('* as count');
    const finalPriceCount = await db('timeseries.token_prices').count('* as count');
    
    const finalTokens = Number(finalTokenCount[0].count);
    const finalPrices = Number(finalPriceCount[0].count);
    
    const totalNewTokens = finalTokens - initialTokens;
    const totalNewPrices = finalPrices - initialPrices;
    
    // Tokens created during monitoring
    const monitoredTokens = await db('tokens')
      .where('created_at', '>', stats.startTime)
      .select('address', 'symbol', 'last_price_update', 'price_update_count');
    
    const tokensWithPriceUpdates = monitoredTokens.filter(t => t.last_price_update !== null).length;
    const tokensWithoutPriceUpdates = monitoredTokens.filter(t => t.last_price_update === null).length;
    
    console.log(`Total new tokens: ${totalNewTokens}`);
    console.log(`Total new price records: ${totalNewPrices}`);
    console.log(`Tokens with price updates: ${tokensWithPriceUpdates}`);
    console.log(`Tokens WITHOUT price updates: ${tokensWithoutPriceUpdates}`);
    
    if (tokensWithoutPriceUpdates > 0) {
      console.log('\n⚠️  ISSUE: Some tokens are not receiving price updates!');
      console.log('This suggests the race condition is occurring.');
      
      const problematicTokens = monitoredTokens
        .filter(t => t.last_price_update === null)
        .slice(0, 5);
      
      console.log('\nProblematic tokens:');
      problematicTokens.forEach(t => {
        console.log(`- ${t.address} (${t.symbol || 'UNKNOWN'})`);
      });
    }
    
    await db.destroy();
    process.exit(0);
  }, 60000); // Run for 60 seconds
}

// Run the monitor
monitorGrpcFlow().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});