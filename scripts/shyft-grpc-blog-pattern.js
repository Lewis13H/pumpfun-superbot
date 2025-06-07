require('dotenv').config();
const { default: Client, CommitmentLevel } = require("@triton-one/yellowstone-grpc");
const base58 = require('bs58');

console.log('\n🚀 Shyft gRPC - Using Blog Pattern');
console.log('==================================================');

const GRPC_ENDPOINT = 'https://grpc.ams.shyft.to';
const TOKEN = '0b63e431-3145-4101-ac9d-68f8b33ded4b';
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const client = new Client(GRPC_ENDPOINT, TOKEN, undefined);

// Decode function from blog
function decodeTransact(data) {
  if (!data) return null;
  
  // Handle different data formats
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) {
    return base58.default ? base58.default.encode(data) : base58.encode(data);
  }
  if (data.data) {
    const buffer = Buffer.from(data.data);
    return base58.default ? base58.default.encode(buffer) : base58.encode(buffer);
  }
  
  return null;
}

// Format output as shown in blog
function tOutPut(data) {
  try {
    const dataTx = data.transaction.transaction;
    const signature = decodeTransact(dataTx.signature);
    const message = dataTx.transaction?.message;
    const header = message.header;
    const accountKeys = message.accountKeys.map((t) => decodeTransact(t));
    const recentBlockhash = decodeTransact(message.recentBlockhash);
    const instructions = message.instructions;
    const meta = dataTx?.meta;
    
    return {
      signature,
      message: {
        header,
        accountKeys,
        recentBlockhash,
        instructions
      },
      meta,
      slot: data.transaction.slot
    };
  } catch (error) {
    console.error('Format error:', error.message);
    return null;
  }
}

// Parse Pump.fun instructions
function parsePumpInstructions(result) {
  const pumpInstructions = [];
  
  if (!result?.message?.instructions) return pumpInstructions;
  
  const accountKeys = result.message.accountKeys;
  
  result.message.instructions.forEach((instruction, idx) => {
    // Check if this is a Pump.fun instruction
    const programIdIndex = instruction.programIdIndex;
    if (programIdIndex !== undefined && accountKeys[programIdIndex] === PUMP_FUN_PROGRAM) {
      const data = instruction.data;
      const discriminator = Buffer.isBuffer(data) ? data[0] : data?.data?.[0];
      
      if (discriminator) {
        // Parse account indices
        const accountIndices = [];
        if (instruction.accounts) {
          const buffer = Buffer.isBuffer(instruction.accounts) ? 
            instruction.accounts : Buffer.from(instruction.accounts);
          for (let i = 0; i < buffer.length; i++) {
            accountIndices.push(buffer[i]);
          }
        }
        
        const accounts = accountIndices.map(idx => accountKeys[idx]).filter(a => a);
        
        // Check log messages for instruction type
        let instructionType = 'unknown';
        if (result.meta?.logMessages) {
          const startIdx = result.meta.logMessages.findIndex(log => 
            log.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke')
          );
          if (startIdx >= 0 && result.meta.logMessages[startIdx + 1]) {
            const instructionLog = result.meta.logMessages[startIdx + 1];
            if (instructionLog.includes('Instruction: Buy')) instructionType = 'buy';
            else if (instructionLog.includes('Instruction: Sell')) instructionType = 'sell';
            else if (instructionLog.includes('Instruction: Create')) instructionType = 'create';
            else if (instructionLog.includes('Instruction: Initialize')) instructionType = 'create';
          }
        }
        
        // Also use discriminator
        if (discriminator === 181) instructionType = 'create';
        else if (discriminator === 102) instructionType = 'buy';
        else if (discriminator === 51) instructionType = 'sell';
        
        pumpInstructions.push({
          type: instructionType,
          discriminator: discriminator,
          accounts: accounts,
          accountCount: accounts.length,
          mint: accounts.length >= 3 ? accounts[2] : accounts[0],
          instructionIndex: idx
        });
      }
    }
  });
  
  return pumpInstructions;
}

async function handleStream(client, args) {
  const stream = await client.subscribe();
  
  let stats = {
    transactions: 0,
    creates: 0,
    buys: 0,
    sells: 0,
    tokens: new Set()
  };

  const streamClosed = new Promise((resolve, reject) => {
    stream.on("error", (error) => {
      console.error("ERROR", error);
      reject(error);
      stream.end();
    });
    stream.on("end", resolve);
    stream.on("close", resolve);
  });

  stream.on("data", async (data) => {
    try {
      if (data?.transaction) {
        stats.transactions++;
        const result = tOutPut(data);
        
        if (result) {
          const pumpInstructions = parsePumpInstructions(result);
          
          if (pumpInstructions.length > 0) {
            console.log(`\n📦 Pump.fun Transaction - Slot ${result.slot}`);
            console.log(`   Signature: ${result.signature?.substring(0, 44)}...`);
            
            pumpInstructions.forEach(inst => {
              console.log(`   ${inst.type.toUpperCase()} (discriminator: ${inst.discriminator})`);
              
              if (inst.type === 'create') {
                stats.creates++;
                if (inst.mint && !stats.tokens.has(inst.mint)) {
                  stats.tokens.add(inst.mint);
                  console.log(`   🎉 NEW TOKEN: ${inst.mint}`);
                  console.log(`   📊 Total unique tokens: ${stats.tokens.size}`);
                }
              } else if (inst.type === 'buy') {
                stats.buys++;
                console.log(`   💰 Token: ${inst.mint}`);
              } else if (inst.type === 'sell') {
                stats.sells++;
                console.log(`   📉 Token: ${inst.mint}`);
              }
            });
            
            // Check for token metadata in logs
            if (result.meta?.logMessages) {
              const programDataLog = result.meta.logMessages.find(log => 
                log.startsWith('Program data:')
              );
              if (programDataLog) {
                console.log(`   📊 Program data available`);
              }
            }
          }
        }
      }
    } catch(error) {
      if (error) {
        console.log('Data processing error:', error.message);
      }
    }
  });

  await new Promise((resolve, reject) => {
    stream.write(args, (err) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(reason);
    throw reason;
  });

  await streamClosed;
}

async function subscribeCommand(client, args) {
  while (true) {
    try {
      await handleStream(client, args);
    } catch (error) {
      console.error("Stream error, restarting in 1 second...", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Request using 'bondingCurve' name as shown in blog
const req = {
  accounts: {},
  slots: {},
  transactions: {
    bondingCurve: {  // Using their naming convention
      vote: false,
      failed: false,
      signature: undefined,
      accountInclude: [PUMP_FUN_PROGRAM],
      accountExclude: [],
      accountRequired: [],
    },
  },
  transactionsStatus: {},
  entry: {},
  blocks: {},
  blocksMeta: {},
  accountsDataSlice: [],
  ping: undefined,
  commitment: CommitmentLevel.CONFIRMED,
};

console.log('🚀 Starting Pump.fun stream using blog pattern...\n');

// Stats every 30 seconds
setInterval(() => {
  console.log(`\n📊 Stats Update:`);
  console.log(`   Transactions: ${stats.transactions}`);
  console.log(`   Creates: ${stats.creates}`);
  console.log(`   Buys: ${stats.buys}`);
  console.log(`   Sells: ${stats.sells}`);
  console.log(`   Unique tokens: ${stats.tokens.size}`);
}, 30000);

subscribeCommand(client, req);