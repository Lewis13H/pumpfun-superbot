import { buySignalService } from "../src/trading/buy-signal-service";
import { db } from "../src/database/postgres";
import { DexScreenerClient } from "../src/api/dexscreener-client";

const dexScreener = new DexScreenerClient();

async function logPaperTrades() {
  console.log("Starting paper trade logger...");
  
  buySignalService.on("buySignal", async (signal: any) => {
    console.log(`\n🎯 NEW BUY SIGNAL: ${signal.symbol}`);
    console.log(`   Position: ${signal.position.finalPosition} SOL`);
    console.log(`   Confidence: ${(signal.evaluation.confidence * 100).toFixed(1)}%`);
    
    try {
      // Get current price
      const pairs = await dexScreener.getTokenPairs(signal.tokenAddress);
      const currentPrice = pairs[0]?.priceUsd || 0;
      
      // Log paper trade
      await db("paper_trades").insert({
        token_address: signal.tokenAddress,
        symbol: signal.symbol,
        signal_time: signal.timestamp,
        entry_price: currentPrice,
        entry_market_cap: signal.evaluation.marketCap,
        position_size: signal.position.finalPosition,
        confidence: signal.evaluation.confidence * 100,
        status: "OPEN"
      });
      
      console.log(`   ✅ Paper trade logged at $${currentPrice}`);
    } catch (err: any) {
      console.error("   ❌ Error logging trade:", err.message || err);
    }
  });
  
  // Keep process alive
  setInterval(() => {}, 1000);
}

logPaperTrades().catch(console.error);
