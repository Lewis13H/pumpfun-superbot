// scripts/test-new-grpc.ts - Test the new gRPC implementation
import { YellowstoneGrpcClient } from '../src/grpc/yellowstone-grpc-client';
import { config } from '../src/config';

async function testNewGrpc() {
  console.log('\n=== Testing New gRPC Implementation ===\n');
  
  const client = new YellowstoneGrpcClient({
    endpoint: config.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
    token: config.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b'
  });
  
  const stats = {
    accountUpdates: 0,
    priceUpdates: 0,
    tokenCreations: 0,
    transactions: 0,
    bondingCurvesFound: new Set<string>(),
    tokensFound: new Set<string>()
  };
  
  // Monitor events
  client.on('priceUpdate', (price) => {
    stats.priceUpdates++;
    stats.tokensFound.add(price.tokenAddress);
    console.log(`[PRICE] Token: ${price.tokenAddress.substring(0, 10)}... Price: $${price.priceUsd.toFixed(6)} MC: $${price.marketCap.toFixed(2)}`);
  });
  
  client.on('tokenCreated', (tx) => {
    stats.tokenCreations++;
    stats.tokensFound.add(tx.tokenAddress);
    if (tx.bondingCurve) {
      stats.bondingCurvesFound.add(tx.bondingCurve);
    }
    console.log(`[NEW TOKEN] ${tx.tokenAddress} BC: ${tx.bondingCurve || 'NOT FOUND'}`);
  });
  
  client.on('transaction', (tx) => {
    stats.transactions++;
    console.log(`[TX] ${tx.type} on ${tx.tokenAddress.substring(0, 10)}...`);
  });
  
  client.on('nearGraduation', (data) => {
    console.log(`[GRADUATION] Token ${data.tokenAddress.substring(0, 10)}... at ${data.progress.toFixed(2)}%`);
  });
  
  client.on('error', (error) => {
    console.error('[ERROR]', error.message);
  });
  
  client.on('connected', () => {
    console.log('✅ Connected to gRPC\n');
  });
  
  try {
    console.log('Connecting...');
    await client.connect();
    
    console.log('Monitoring for 60 seconds...\n');
    
    // Show stats every 10 seconds
    const statsInterval = setInterval(() => {
      console.log('\n--- Current Stats ---');
      console.log(`Price updates: ${stats.priceUpdates}`);
      console.log(`Token creations: ${stats.tokenCreations}`);
      console.log(`Transactions: ${stats.transactions}`);
      console.log(`Unique tokens: ${stats.tokensFound.size}`);
      console.log(`Unique bonding curves: ${stats.bondingCurvesFound.size}`);
      console.log('---\n');
    }, 10000);
    
    // Run for 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    clearInterval(statsInterval);
    
    console.log('\n=== Final Stats ===');
    console.log(`Total price updates: ${stats.priceUpdates}`);
    console.log(`Total token creations: ${stats.tokenCreations}`);
    console.log(`Total transactions: ${stats.transactions}`);
    console.log(`Unique tokens tracked: ${stats.tokensFound.size}`);
    console.log(`Unique bonding curves found: ${stats.bondingCurvesFound.size}`);
    
    if (stats.priceUpdates === 0) {
      console.log('\n❌ NO PRICE UPDATES RECEIVED!');
      console.log('Possible issues:');
      console.log('1. No active bonding curves (all graduated)');
      console.log('2. Connection issues');
      console.log('3. Subscription not working properly');
    } else {
      console.log('\n✅ Price updates are working!');
    }
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await client.disconnect();
    process.exit(0);
  }
}

// Run test
testNewGrpc();