// scripts/capture-create-tx.ts - Capture and analyze token creation transactions
import { YellowstoneGrpcClient } from '../src/grpc/yellowstone-grpc-client';
import { config } from '../src/config';
import fs from 'fs/promises';

async function captureCreateTransactions() {
  console.log('\n=== Capturing Token Creation Transactions ===\n');
  
  const client = new YellowstoneGrpcClient({
    endpoint: config.GRPC_ENDPOINT || 'grpc.ams.shyft.to',
    token: config.GRPC_TOKEN || '0b63e431-3145-4101-ac9d-68f8b33ded4b'
  });
  
  let capturedCount = 0;
  const maxCaptures = 3;
  
  // Override the handleTransaction method to capture raw data
  const originalHandleTransaction = (client as any).handleTransaction.bind(client);
  (client as any).handleTransaction = async function(data: any) {
    try {
      const result = (client as any).transformOutput(data);
      
      if (result && result.logFilter) {
        // This is a token creation
        capturedCount++;
        
        console.log(`\n=== Captured Create Transaction ${capturedCount} ===`);
        console.log(`Signature: ${result.signature}`);
        console.log(`Account Keys: ${result.message.accountKeys.length}`);
        
        // Save raw data for analysis
        const filename = `create-tx-${capturedCount}-${Date.now()}.json`;
        await fs.writeFile(
          filename,
          JSON.stringify({
            raw: data,
            transformed: result,
            accountKeys: result.message.accountKeys,
            instructions: result.message.instructions
          }, null, 2)
        );
        
        console.log(`✅ Saved to ${filename}`);
        
        // Analyze the transaction
        console.log('\nAccount Keys:');
        result.message.accountKeys.forEach((key: string, i: number) => {
          let type = 'Unknown';
          if (key.endsWith('pump')) type = 'Token Mint';
          else if (key === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') type = 'Pump Program';
          else if (key === '11111111111111111111111111111111') type = 'System Program';
          else if (i === 0) type = 'User/Payer';
          
          console.log(`  [${i}] ${key.substring(0, 20)}... (${type})`);
        });
        
        // Look for pump instruction
        console.log('\nInstructions:');
        for (const ix of result.message.instructions) {
          const programId = result.message.accountKeys[ix.programIdIndex];
          console.log(`  Program: ${programId.substring(0, 20)}...`);
          
          if (programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') {
            console.log(`  Pump instruction with ${ix.accounts?.length || 0} accounts:`);
            
            if (ix.accounts) {
              ix.accounts.forEach((accIndex: number, i: number) => {
                const account = result.message.accountKeys[accIndex];
                console.log(`    [${i}] Account index ${accIndex}: ${account.substring(0, 30)}...`);
              });
            }
          }
        }
        
        if (capturedCount >= maxCaptures) {
          console.log(`\n✅ Captured ${maxCaptures} transactions. Stopping...`);
          await client.disconnect();
          process.exit(0);
        }
      }
    } catch (error) {
      console.error('Error in transaction handler:', error);
    }
    
    // Call original handler
    return originalHandleTransaction(data);
  };
  
  try {
    console.log('Connecting to gRPC stream...');
    await client.connect();
    console.log('✅ Connected! Waiting for token creations...\n');
    
    // Keep running until we capture enough transactions
    await new Promise(() => {});
    
  } catch (error) {
    console.error('Error:', error);
    await client.disconnect();
    process.exit(1);
  }
}

// Run capture
captureCreateTransactions();