// scripts/raw-grpc-logger.js - Log raw gRPC stream data
require('dotenv').config();
const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

async function rawGrpcLogger() {
  console.log('\n=== Raw gRPC Stream Logger ===\n');
  
  const endpoint = process.env.GRPC_ENDPOINT || 'grpc.ams.shyft.to';
  const token = process.env.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b';
  
  // Clean up endpoint
  const cleanEndpoint = endpoint.trim().replace(/['"]/g, '');
  const endpointWithProtocol = cleanEndpoint.includes('://') 
    ? cleanEndpoint 
    : `https://${cleanEndpoint}`;
  
  console.log(`Endpoint: ${endpointWithProtocol}`);
  console.log(`Token: ${token.substring(0, 10)}...`);
  
  const client = new Client(endpointWithProtocol, token.trim().replace(/['"]/g, ''), undefined);
  
  try {
    console.log('\nCreating subscription...');
    const stream = await client.subscribe();
    console.log('✅ Subscription created\n');
    
    let messageCount = 0;
    let accountCount = 0;
    let transactionCount = 0;
    
    // Handle data
    stream.on('data', (data) => {
      messageCount++;
      
      if (data.transaction) {
        transactionCount++;
        console.log(`[${new Date().toISOString()}] TRANSACTION`);
        
        // Check if it has Pump program
        const tx = data.transaction?.transaction;
        if (tx) {
          const hasPump = JSON.stringify(tx).includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
          if (hasPump) {
            console.log('  ✅ Contains Pump program!');
          }
        }
      }
      
      if (data.account) {
        accountCount++;
        console.log(`[${new Date().toISOString()}] ACCOUNT UPDATE`);
        
        const account = data.account.account;
        if (account) {
          console.log(`  Pubkey: ${account.pubkey ? Buffer.from(account.pubkey).toString('base64').substring(0, 20) + '...' : 'unknown'}`);
          console.log(`  Owner: ${account.owner ? Buffer.from(account.owner).toString('base64').substring(0, 20) + '...' : 'unknown'}`);
          console.log(`  Data length: ${account.data ? account.data.length : 0}`);
        }
      }
      
      if (data.ping) {
        console.log(`[${new Date().toISOString()}] PING`);
      }
      
      if (data.pong) {
        console.log(`[${new Date().toISOString()}] PONG`);
      }
      
      // Show stats every 10 messages
      if (messageCount % 10 === 0) {
        console.log(`\n--- Stats: ${messageCount} messages, ${transactionCount} txs, ${accountCount} accounts ---\n`);
      }
    });
    
    // Handle errors
    stream.on('error', (error) => {
      console.error('Stream error:', error);
    });
    
    stream.on('end', () => {
      console.log('Stream ended');
    });
    
    stream.on('close', () => {
      console.log('Stream closed');
    });
    
    // Send subscription request
    const request = {
      accounts: {
        // Try subscribing to all Pump-owned accounts
        pump: {
          account: [],
          owner: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
          filters: []
        }
      },
      slots: {},
      transactions: {
        pump: {
          vote: false,
          failed: false,
          accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: 1
    };
    
    console.log('Sending subscription request...');
    console.log('Request:', JSON.stringify(request, null, 2));
    
    stream.write(request, (err) => {
      if (err) {
        console.error('Write error:', err);
      } else {
        console.log('✅ Subscription request sent\n');
        console.log('Waiting for data...\n');
      }
    });
    
    // Run for 2 minutes
    setTimeout(() => {
      console.log('\n=== Final Stats ===');
      console.log(`Total messages: ${messageCount}`);
      console.log(`Transactions: ${transactionCount}`);
      console.log(`Account updates: ${accountCount}`);
      
      stream.end();
      process.exit(0);
    }, 120000);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run logger
rawGrpcLogger();