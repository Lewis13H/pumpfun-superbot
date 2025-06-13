// example-integration.ts
// Complete example showing how to integrate Shyft RPC with existing gRPC stream

import { config } from 'dotenv';
config();

// Environment variables setup
const ENV_CONFIG = {
  // Shyft Configuration
  SHYFT_API_KEY: process.env.SHYFT_API_KEY!, // Your Shyft API key
  SHYFT_RPC_URL: process.env.SHYFT_RPC_URL || `https://rpc.shyft.to?api_key=${process.env.SHYFT_API_KEY}`,
  GRPC_URL: process.env.GRPC_URL!, // Your Shyft gRPC URL
  X_TOKEN: process.env.X_TOKEN!, // Your Shyft gRPC token
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL!,
  
  // Other services
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL!
};

// Example .env file content:
/*
SHYFT_API_KEY=your_shyft_api_key_here
GRPC_URL=your_region_specific_grpc_url
X_TOKEN=your_grpc_access_token
DATABASE_URL=postgresql://user:password@localhost:5432/pumpfun_bot
HELIUS_RPC_URL=your_helius_rpc_url
*/

// 1. Initialize Shyft RPC Service
import { ShyftRPCService } from './services/shyft-rpc-service';
const shyftRPC = new ShyftRPCService();

// 2. Enhanced token creation handler
async function handleNewTokenCreation(tokenAddress: string, signature: string) {
  console.log(`🆕 New token detected: ${tokenAddress}`);
  
  try {
    // Step 1: Get token info from Shyft RPC
    const tokenInfo = await shyftRPC.getTokenInfo(tokenAddress);
    
    if (tokenInfo) {
      console.log(`✅ Token Info Retrieved:
        Name: ${tokenInfo.name}
        Symbol: ${tokenInfo.symbol}
        Supply: ${tokenInfo.supply}
        Decimals: ${tokenInfo.decimals}
      `);
      
      // Step 2: Get initial holder distribution
      const holders = await shyftRPC.getTokenHolders(tokenAddress, 10);
      console.log(`👥 Top 10 holders control: ${holders.reduce((sum, h) => sum + h.percentage, 0).toFixed(2)}%`);
      
      // Step 3: Parse the creation transaction
      const txDetails = await shyftRPC.parsePumpfunInstruction(signature);
      console.log(`📝 Transaction parsed:`, txDetails);
    }
    
  } catch (error) {
    console.error('Error processing new token:', error);
  }
}

// 3. Enhanced price monitoring with bonding curve
async function monitorTokenPrice(tokenAddress: string, bondingCurveAddress: string) {
  try {
    // Get current bonding curve balance
    const curveBalance = await shyftRPC.getBondingCurveBalance(bondingCurveAddress);
    const progress = (curveBalance / 85) * 100; // 85 SOL target
    
    console.log(`💰 Bonding Curve Status:
      Token: ${tokenAddress.substring(0, 8)}...
      Balance: ${curveBalance} SOL
      Progress: ${progress.toFixed(2)}% to completion
    `);
    
    // Alert if near graduation
    if (progress > 80) {
      console.log(`🚨 NEAR GRADUATION: ${tokenAddress} at ${progress.toFixed(2)}%`);
    }
    
  } catch (error) {
    console.error('Error monitoring price:', error);
  }
}

// 4. Complete gRPC stream integration example
import Client from "@triton-one/yellowstone-grpc";

async function startEnhancedStream() {
  // Initialize gRPC client
  const client = new Client(
    ENV_CONFIG.GRPC_URL,
    ENV_CONFIG.X_TOKEN,
    undefined
  );
  
  // Create subscription request
  const req = {
    accounts: {
      // Monitor pump.fun bonding curves
      pumpBondingCurves: {
        account: [],
        filters: [],
        owner: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]
      }
    },
    slots: {},
    transactions: {
      // Monitor pump.fun transactions
      pumpfun: {
        vote: false,
        failed: false,
        accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"],
        accountExclude: [],
        accountRequired: []
      }
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: 1 // CONFIRMED
  };
  
  // Subscribe to stream
  const stream = await client.subscribe();
  
  // Handle stream data
  stream.on("data", async (data) => {
    try {
      // Handle transactions
      if (data.transaction) {
        const signature = Buffer.from(data.transaction.transaction.signature).toString('base64');
        console.log(`📨 Transaction: ${signature.substring(0, 16)}...`);
        
        // Check if it's a token creation
        const meta = data.transaction.transaction.meta;
        if (meta?.logMessages?.some((log: string) => log.includes('Instruction: Create'))) {
          // Extract token address from postTokenBalances
          const tokenMint = meta.postTokenBalances?.[0]?.mint;
          if (tokenMint) {
            await handleNewTokenCreation(tokenMint, signature);
          }
        }
      }
      
      // Handle account updates (bonding curves)
      if (data.account) {
        const accountKey = Buffer.from(data.account.account.pubkey).toString('base64');
        console.log(`📊 Account update: ${accountKey.substring(0, 16)}...`);
        
        // Parse bonding curve data and monitor
        // This would integrate with your existing bonding curve parsing logic
      }
      
    } catch (error) {
      console.error('Stream processing error:', error);
    }
  });
  
  // Send subscription
  await new Promise<void>((resolve, reject) => {
    stream.write(req, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  console.log('✅ Enhanced stream started with Shyft RPC integration');
}

// 5. Example: Analyze token for trading decision
async function analyzeTokenForTrading(tokenAddress: string) {
  try {
    console.log(`\n🔍 Analyzing token: ${tokenAddress}\n`);
    
    // Get comprehensive data
    const [tokenInfo, holders, transactions] = await Promise.all([
      shyftRPC.getTokenInfo(tokenAddress),
      shyftRPC.getTokenHolders(tokenAddress, 25),
      shyftRPC.getTokenTransactions(tokenAddress, 10)
    ]);
    
    // Calculate metrics
    const top10Holding = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);
    const isConcentrated = top10Holding > 50;
    
    // Analyze recent transactions
    const recentBuys = transactions.filter((tx: any) => 
      tx.type === 'TOKEN_TRANSFER' && tx.info?.amount > 0
    ).length;
    
    console.log(`📊 Analysis Results:
      Symbol: ${tokenInfo?.symbol || 'Unknown'}
      Name: ${tokenInfo?.name || 'Unknown'}
      Supply: ${tokenInfo?.supply || 0}
      
      Holder Analysis:
      - Total Holders: ${holders.length}
      - Top 10 Control: ${top10Holding.toFixed(2)}%
      - Concentration Risk: ${isConcentrated ? 'HIGH ⚠️' : 'LOW ✅'}
      
      Activity:
      - Recent Transactions: ${transactions.length}
      - Recent Buys: ${recentBuys}
    `);
    
    // Trading recommendation
    const score = calculateTradingScore({
      concentration: top10Holding,
      holders: holders.length,
      recentActivity: transactions.length
    });
    
    console.log(`\n🎯 Trading Score: ${score}/100`);
    console.log(`Recommendation: ${score > 70 ? 'CONSIDER BUY 🟢' : score > 40 ? 'MONITOR 🟡' : 'AVOID 🔴'}`);
    
  } catch (error) {
    console.error('Analysis error:', error);
  }
}

function calculateTradingScore(metrics: any): number {
  let score = 100;
  
  // Penalize high concentration
  if (metrics.concentration > 60) score -= 30;
  else if (metrics.concentration > 40) score -= 15;
  
  // Reward good holder count
  if (metrics.holders < 50) score -= 20;
  else if (metrics.holders > 200) score += 10;
  
  // Activity score
  if (metrics.recentActivity < 5) score -= 10;
  else if (metrics.recentActivity > 20) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

// 6. Main execution
async function main() {
  console.log('🚀 Starting Enhanced Pump.fun Bot with Shyft RPC Integration\n');
  
  // Validate environment
  if (!ENV_CONFIG.SHYFT_API_KEY || !ENV_CONFIG.GRPC_URL || !ENV_CONFIG.X_TOKEN) {
    console.error('❌ Missing required environment variables!');
    process.exit(1);
  }
  
  // Test Shyft RPC connection
  console.log('Testing Shyft RPC connection...');
  const testToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
  const testInfo = await shyftRPC.getTokenInfo(testToken);
  console.log(`✅ Shyft RPC working: ${testInfo?.symbol || 'Failed'}\n`);
  
  // Start enhanced stream
  await startEnhancedStream();
  
  // Example: Analyze a specific token after 10 seconds
  setTimeout(async () => {
    await analyzeTokenForTrading('YOUR_TOKEN_ADDRESS_HERE');
  }, 10000);
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

// Run the bot
main().catch(console.error);