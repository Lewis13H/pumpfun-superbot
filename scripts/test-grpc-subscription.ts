// scripts/test-grpc-subscription.ts - Test if we're receiving account updates
import { YellowstoneGrpcClient } from '../src/grpc/yellowstone-grpc-client';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function testGrpcSubscription() {
  console.log('\n=== Testing gRPC Subscription ===\n');
  
  const client = new YellowstoneGrpcClient({
    endpoint: config.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
    token: config.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b'
  });
  
  // Get some tokens with bonding curves to monitor
  const tokensWithBC = await db('tokens')
    .whereNotNull('bonding_curve')
    .orderBy('created_at', 'desc')
    .limit(5)
    .select('address', 'symbol', 'bonding_curve');
  
  console.log(`Found ${tokensWithBC.length} tokens with bonding curves to monitor`);
  
  if (tokensWithBC.length === 0) {
    console.log('No tokens with bonding curves found!');
    await db.destroy();
    return;
  }
  
  // Track what we receive
  const stats = {
    transactions: 0,
    tokenCreations: 0,
    priceUpdates: 0,
    accountUpdates: 0,
    startTime: Date.now()
  };
  
  // Monitor events
  client.on('transaction', (tx) => {
    stats.transactions++;
    console.log(`[TX] ${tx.type} for ${tx.tokenAddress?.substring(0, 10) || 'unknown'}...`);
  });
  
  client.on('tokenCreated', (tx) => {
    stats.tokenCreations++;
    console.log(`[NEW TOKEN] ${tx.tokenAddress} with BC: ${tx.bondingCurve?.substring(0, 20) || 'NONE'}...`);
  });
  
  client.on('priceUpdate', (price) => {
    stats.priceUpdates++;
    console.log(`[PRICE] ${price.tokenAddress.substring(0, 10)}... = $${price.priceUsd.toFixed(6)} (MC: $${price.marketCap.toFixed(2)})`);
  });
  
  // Add raw account update handler to see what's happening
  const originalHandleAccountUpdate = (client as any).handleAccountUpdate.bind(client);
  (client as any).handleAccountUpdate = async function(account: any) {
    stats.accountUpdates++;
    
    const accountKey = (client as any).decodeBase58(account.account.pubkey);
    const owner = (client as any).decodeBase58(account.account.owner);
    
    console.log(`[ACCOUNT UPDATE] ${accountKey.substring(0, 20)}... owned by ${owner.substring(0, 20)}...`);
    
    // Call original handler
    return originalHandleAccountUpdate(account);
  };
  
  try {
    console.log('\nConnecting to gRPC...');
    await client.connect();
    console.log('✅ Connected!\n');
    
    // Show what we're monitoring
    console.log('Monitoring these bonding curves:');
    tokensWithBC.forEach(t => {
      console.log(`- Token: ${t.address.substring(0, 20)}... (${t.symbol})`);
      console.log(`  BC: ${t.bonding_curve}`);
    });
    
    console.log('\nWaiting for events... (60 seconds)\n');
    
    // Update stats every 10 seconds
    const statsInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
      console.log(`\n--- Stats after ${elapsed}s ---`);
      console.log(`Transactions: ${stats.transactions}`);
      console.log(`Token creations: ${stats.tokenCreations}`);
      console.log(`Price updates: ${stats.priceUpdates}`);
      console.log(`Account updates: ${stats.accountUpdates}`);
      console.log('---\n');
    }, 10000);
    
    // Run for 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    clearInterval(statsInterval);
    
    console.log('\n=== Final Stats ===');
    console.log(`Total transactions: ${stats.transactions}`);
    console.log(`Total token creations: ${stats.tokenCreations}`);
    console.log(`Total price updates: ${stats.priceUpdates}`);
    console.log(`Total account updates: ${stats.accountUpdates}`);
    
    if (stats.accountUpdates === 0) {
      console.log('\n❌ NO ACCOUNT UPDATES RECEIVED!');
      console.log('This explains why there are no price updates.');
      console.log('The subscription to bonding curve accounts is not working.');
    }
    
    if (stats.priceUpdates === 0) {
      console.log('\n❌ NO PRICE UPDATES RECEIVED!');
      console.log('This confirms the issue - we are not getting bonding curve state updates.');
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await client.disconnect();
    await db.destroy();
  }
}

// Run test
testGrpcSubscription();