import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../src/config';

async function testTokenDataFetch() {
  try {
    // Use the correct config path
    const connection = new Connection(config.apis.heliusRpcUrl);
    const tokenAddress = '4kUCiUTyyqgP1B6xmTpJCYt4j3DQ1hZ3huREP72wpump'; // Example token
    
    console.log('Testing Helius RPC connection...');
    
    // Try to get token supply
    try {
      const supply = await connection.getTokenSupply(new PublicKey(tokenAddress));
      console.log('Token supply:', supply);
    } catch (e) {
      console.log('Token supply error:', e.message);
    }
    
    // Try basic RPC health check
    const health = await connection.getHealth();
    console.log('RPC health:', health);
    
    // Get recent blockhash to verify connection
    const blockhash = await connection.getLatestBlockhash();
    console.log('Latest blockhash:', blockhash.blockhash.substring(0, 10) + '...');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testTokenDataFetch();
