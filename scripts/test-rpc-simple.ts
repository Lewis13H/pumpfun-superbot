import { Connection } from '@solana/web3.js';
import { config } from '../src/config';

async function testRPC() {
  try {
    console.log('Testing RPC connection...');
    console.log('RPC URL:', config.apis.heliusRpcUrl);
    
    const connection = new Connection(config.apis.heliusRpcUrl);
    
    // Get slot (basic test)
    const slot = await connection.getSlot();
    console.log('Current slot:', slot);
    
    // Get version
    const version = await connection.getVersion();
    console.log('Solana version:', version);
    
    console.log('✅ RPC connection working');
    
  } catch (error: any) {
    console.error('RPC Error:', error.message);
  }
}

testRPC();
