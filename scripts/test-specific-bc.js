// scripts/test-specific-bc.js - Test subscribing to specific bonding curves
require('dotenv').config();
const knex = require('knex');
const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
  }
});

async function testSpecificBC() {
  console.log('\n=== Testing Specific Bonding Curve Subscription ===\n');
  
  // Get some bonding curves from DB
  const tokensWithBC = await db('tokens')
    .whereNotNull('bonding_curve')
    .orderBy('created_at', 'desc')
    .limit(3)
    .select('address', 'symbol', 'bonding_curve');
  
  if (tokensWithBC.length === 0) {
    console.log('No tokens with bonding curves found!');
    await db.destroy();
    return;
  }
  
  console.log(`Found ${tokensWithBC.length} tokens with bonding curves:`);
  tokensWithBC.forEach(t => {
    console.log(`- ${t.symbol}: ${t.bonding_curve}`);
  });
  
  const endpoint = process.env.GRPC_ENDPOINT || 'grpc.ams.shyft.to';
  const token = process.env.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b';
  
  const cleanEndpoint = endpoint.trim().replace(/['"]/g, '');
  const endpointWithProtocol = cleanEndpoint.includes('://') 
    ? cleanEndpoint 
    : `https://${cleanEndpoint}`;
  
  const client = new Client(endpointWithProtocol, token.trim().replace(/['"]/g, ''), undefined);
  
  try {
    console.log('\nCreating subscription...');
    const stream = await client.subscribe();
    console.log('✅ Subscription created\n');
    
    let accountUpdates = 0;
    const bondingCurves = tokensWithBC.map(t => t.bonding_curve);
    
    // Handle data
    stream.on('data', (data) => {
      if (data.account) {
        accountUpdates++;
        
        const account = data.account.account;
        if (account && account.pubkey) {
          // Decode base58
          const bs58 = require('bs58').default;
          let pubkey;
          
          try {
            if (typeof account.pubkey === 'string') {
              pubkey = account.pubkey;
            } else if (Buffer.isBuffer(account.pubkey)) {
              pubkey = bs58.encode(account.pubkey);
            } else if (account.pubkey.data) {
              pubkey = bs58.encode(Buffer.from(account.pubkey.data));
            }
            
            console.log(`[ACCOUNT UPDATE] ${pubkey}`);
            
            // Check if it's one of our bonding curves
            if (bondingCurves.includes(pubkey)) {
              console.log('  ✅ This is one of our monitored bonding curves!');
              console.log(`  Data length: ${account.data ? account.data.length : 0}`);
            }
          } catch (e) {
            console.error('Error decoding pubkey:', e);
          }
        }
      }
    });
    
    // Send subscription request with specific accounts
    const request = {
      accounts: {
        // Subscribe to specific bonding curve accounts
        specificBC: {
          account: bondingCurves,
          owner: [],
          filters: []
        }
      },
      slots: {},
      transactions: {},
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: 1
    };
    
    console.log('\nSubscribing to specific accounts:');
    bondingCurves.forEach(bc => console.log(`- ${bc}`));
    
    stream.write(request, (err) => {
      if (err) {
        console.error('Write error:', err);
      } else {
        console.log('\n✅ Subscription request sent\n');
        console.log('Waiting for account updates...\n');
      }
    });
    
    // Run for 60 seconds
    setTimeout(() => {
      console.log('\n=== Results ===');
      console.log(`Account updates received: ${accountUpdates}`);
      
      if (accountUpdates === 0) {
        console.log('\n❌ NO ACCOUNT UPDATES RECEIVED!');
        console.log('Possible issues:');
        console.log('1. The bonding curve addresses might be invalid');
        console.log('2. The gRPC endpoint might not support account subscriptions');
        console.log('3. The accounts might not be changing (no trades)');
      }
      
      stream.end();
      db.destroy();
      process.exit(0);
    }, 60000);
    
  } catch (error) {
    console.error('Fatal error:', error);
    await db.destroy();
    process.exit(1);
  }
}

// Run test
testSpecificBC();