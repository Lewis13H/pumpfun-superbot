import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../src/config';

async function testTokenDataFetch() {
  try {
    const connection = new Connection(config.rpc.heliusUrl);
    const tokenAddress = '4kUCiUTyyqgP1B6xmTpJCYt4j3DQ1hZ3huREP72wpump'; // Example token
    
    // Try to get token supply
    const supply = await connection.getTokenSupply(new PublicKey(tokenAddress));
    console.log('Token supply:', supply);
    
    // Try to get token account info
    const accountInfo = await connection.getParsedAccountInfo(new PublicKey(tokenAddress));
    console.log('Account info:', accountInfo.value?.data);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testTokenDataFetch();
