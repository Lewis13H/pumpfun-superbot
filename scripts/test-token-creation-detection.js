// scripts/test-token-creation-detection.js
// Diagnostic test to check why no new tokens are being detected

// 🔧 FIXED: Load environment variables first
require('dotenv').config();

const { db } = require('../src/database/postgres-js');

// Create a simplified transaction inspector
class TokenCreationDiagnostic {
  constructor() {
    this.transactionCount = 0;
    this.createDetectionCount = 0;
    this.logMessages = [];
    this.instructionData = [];
  }

  // Test the EXACT same logic as yellowstone-grpc-client
  testTransactionForCreate(transaction) {
    this.transactionCount++;

    const result = this.mockTransformOutput(transaction);
    if (!result || !result.signature) {
      return false;
    }

    // EXACT SAME LOGIC as yellowstone-grpc-client.ts
    const logs = result.meta?.logMessages || [];
    
    // Enhanced create detection (copied from yellowstone-grpc-client)
    const hasCreateLog = logs.some((log) => 
      log.includes('Program log: Instruction: Create') && 
      log.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') // Must be from Pump.fun program
    ) || logs.some((log) => 
      log.includes('InitializeMint') &&
      !log.includes('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Not just associated token creation
    );

    // ALSO check for actual Pump.fun CREATE instructions in the transaction data
    const hasPumpFunCreateInstruction = result.message?.instructions?.some((instruction) => {
      const programId = result.message.accountKeys[instruction.programIdIndex];
      if (programId !== '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') return false;
      
      const data = Buffer.from(instruction.data);
      const discriminator = data[0];
      return [181, 234].includes(discriminator); // CREATE_DISCRIMINATORS
    }) || false;

    const hasCreate = hasCreateLog || hasPumpFunCreateInstruction;

    if (hasCreate) {
      this.createDetectionCount++;
      console.log(`🎉 CREATE DETECTED: ${result.signature.substring(0, 8)}...`);
      console.log(`   Log check: ${hasCreateLog}`);
      console.log(`   Instruction check: ${hasPumpFunCreateInstruction}`);
      return true;
    }

    // Store samples for analysis
    if (this.logMessages.length < 10) {
      this.logMessages.push({
        signature: result.signature.substring(0, 8),
        logs: logs.slice(0, 3), // First 3 logs
        hasCreateLog,
        hasPumpFunCreateInstruction
      });
    }

    return false;
  }

  // Mock the transform function
  mockTransformOutput(data) {
    try {
      return {
        signature: 'mock_signature_' + this.transactionCount,
        message: {
          accountKeys: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'other_account'],
          instructions: data.instructions || []
        },
        meta: {
          logMessages: data.logs || []
        }
      };
    } catch (error) {
      return null;
    }
  }

  printDiagnostics() {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 TOKEN CREATION DIAGNOSTIC RESULTS');
    console.log('='.repeat(60));
    console.log(`📊 Total transactions analyzed: ${this.transactionCount}`);
    console.log(`🎉 Token creations detected: ${this.createDetectionCount}`);
    console.log(`📈 Detection rate: ${this.transactionCount > 0 ? ((this.createDetectionCount / this.transactionCount) * 100).toFixed(2) : 0}%`);
    
    if (this.logMessages.length > 0) {
      console.log('\n📋 Sample transactions analyzed:');
      this.logMessages.forEach((sample, i) => {
        console.log(`  ${i + 1}. ${sample.signature}...`);
        console.log(`     Logs: ${sample.logs.length > 0 ? sample.logs[0].substring(0, 50) + '...' : 'No logs'}`);
        console.log(`     Create log: ${sample.hasCreateLog}`);
        console.log(`     Create instruction: ${sample.hasPumpFunCreateInstruction}`);
      });
    }
    console.log('='.repeat(60));
  }
}

// Test with known pump.fun transaction patterns
async function testTokenCreationDetection() {
  console.log('🔍 Testing Token Creation Detection Logic...\n');

  const diagnostic = new TokenCreationDiagnostic();

  // Test Case 1: Simulate a token creation transaction
  console.log('📋 Test Case 1: Simulated Token Creation');
  const createTransaction = {
    logs: [
      'Program ComputeBudget111111111111111111111111111111 invoke [1]',
      'Program ComputeBudget111111111111111111111111111111 success',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Create',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
      'Program log: Instruction: InitializeMint',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
    ],
    instructions: [{
      programIdIndex: 0, // Points to pump.fun program
      data: [181, 0, 0, 0] // Create discriminator
    }]
  };

  const result1 = diagnostic.testTransactionForCreate(createTransaction);
  console.log(`   Result: ${result1 ? '✅ DETECTED' : '❌ NOT DETECTED'}\n`);

  // Test Case 2: Simulate a buy transaction (should NOT be detected)
  console.log('📋 Test Case 2: Simulated Buy Transaction');
  const buyTransaction = {
    logs: [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Buy',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
      'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success'
    ],
    instructions: [{
      programIdIndex: 0,
      data: [102, 0, 0, 0] // Buy discriminator
    }]
  };

  const result2 = diagnostic.testTransactionForCreate(buyTransaction);
  console.log(`   Result: ${result2 ? '❌ FALSE POSITIVE' : '✅ CORRECTLY NOT DETECTED'}\n`);

  // Test Case 3: Check recent transactions from database
  console.log('📋 Test Case 3: Recent Database Transactions');
  try {
    const recentTransactions = await db('timeseries.token_transactions')
      .where('time', '>', db.raw("NOW() - INTERVAL '10 minutes'"))
      .orderBy('time', 'desc')
      .limit(20)
      .select('signature', 'type', 'token_address', 'time');

    console.log(`   Found ${recentTransactions.length} recent transactions:`);
    
    const createTxs = recentTransactions.filter(tx => tx.type === 'create');
    const buyTxs = recentTransactions.filter(tx => tx.type === 'buy');
    const sellTxs = recentTransactions.filter(tx => tx.type === 'sell');

    console.log(`   - Creates: ${createTxs.length}`);
    console.log(`   - Buys: ${buyTxs.length}`);
    console.log(`   - Sells: ${sellTxs.length}`);

    if (createTxs.length > 0) {
      console.log('\n   Recent CREATE transactions:');
      createTxs.slice(0, 3).forEach((tx, i) => {
        console.log(`     ${i + 1}. ${tx.signature.substring(0, 8)}... | ${tx.token_address.substring(0, 8)}... | ${tx.time.toLocaleTimeString()}`);
      });
    } else {
      console.log('   ⚠️ NO CREATE TRANSACTIONS found in recent data!');
    }

  } catch (dbError) {
    console.log(`   ❌ Database error: ${dbError.message}`);
  }

  diagnostic.printDiagnostics();

  // Check if there are any new tokens discovered recently
  console.log('\n📊 Database Analysis:');
  try {
    const newTokensLast10Min = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '10 minutes'"))
      .count('* as count')
      .first();

    const newTokensLast1Hour = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .count('* as count')
      .first();

    console.log(`   📈 New tokens (last 10 min): ${newTokensLast10Min?.count || 0}`);
    console.log(`   📈 New tokens (last 1 hour): ${newTokensLast1Hour?.count || 0}`);

    if (newTokensLast1Hour?.count > 0) {
      const recentTokens = await db('tokens')
        .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
        .orderBy('created_at', 'desc')
        .limit(5)
        .select('address', 'symbol', 'name', 'created_at');

      console.log('\n   🆕 Recent tokens in database:');
      recentTokens.forEach((token, i) => {
        console.log(`     ${i + 1}. ${token.address.substring(0, 8)}... | ${token.symbol} | ${token.created_at.toLocaleTimeString()}`);
      });
    }

  } catch (dbError) {
    console.log(`   ❌ Database error: ${dbError.message}`);
  }

  console.log('\n🎯 RECOMMENDATIONS:');
  console.log('1. Check if gRPC is receiving token creation transactions');
  console.log('2. Verify log message patterns match actual pump.fun creates');
  console.log('3. Check discriminator values for create instructions');
  console.log('4. Monitor if transactions are being processed but not detected as creates');

  process.exit(0);
}

// Run the diagnostic
testTokenCreationDetection().catch(console.error);