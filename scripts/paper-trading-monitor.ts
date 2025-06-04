import { buySignalService } from "../src/trading/buy-signal-service";
import { db } from "../src/database/postgres";
import { categoryManager } from "../src/category/category-manager";
import { scanScheduler } from "../src/category/scan-scheduler";

async function paperTradingMonitor() {
  console.clear();
  console.log("=== PAPER TRADING MONITOR ===");
  console.log(`Time: ${new Date().toLocaleTimeString()}\n`);
  
  // System Status
  const cmStats = categoryManager.getStats();
  const schedStats = scanScheduler.getStats();
  console.log("System Status:");
  console.log(`  Active State Machines: ${cmStats.activeMachines}`);
  console.log(`  Active Scans: ${Object.values(schedStats).reduce((sum: number, s: any) => sum + (s.activeScans || 0), 0)}`);
  
  // AIM Tokens
  const aimTokens = await db("tokens")
    .where("category", "AIM")
    .select("symbol", "market_cap", "liquidity", "solsniffer_score", "buy_attempts");
    
  console.log(`\nAIM Tokens (${aimTokens.length}):`);
  aimTokens.forEach((t: any) => {
    console.log(`  ${t.symbol}: MC=$${t.market_cap}, Liq=$${t.liquidity}, SS=${t.solsniffer_score || "N/A"}, Attempts=${t.buy_attempts || 0}`);
  });
  
  // Active Buy Signals
  const activeSignals = buySignalService.getActiveSignals();
  console.log(`\nActive Buy Signals (${activeSignals.length}):`);
  activeSignals.forEach((signal: any) => {
    console.log(`  ${signal.symbol}: Position=${signal.position.finalPosition} SOL, Confidence=${(signal.evaluation.confidence * 100).toFixed(1)}%`);
  });
  
  // Recent Evaluations
  const recentEvals = await db("buy_evaluations as be")
    .join("tokens as t", "be.token_address", "t.address")
    .where("be.created_at", ">", new Date(Date.now() - 60 * 60 * 1000))
    .select("t.symbol", "be.passed", "be.created_at")
    .orderBy("be.created_at", "desc")
    .limit(5);
    
  console.log("\nRecent Evaluations (1hr):");
  recentEvals.forEach((e: any) => {
    const ago = Math.round((Date.now() - new Date(e.created_at).getTime()) / 60000);
    console.log(`  ${e.symbol}: ${e.passed ? "✅ PASS" : "❌ FAIL"} (${ago}m ago)`);
  });
  
  // Paper Trades (simulated)
  console.log("\n--- PAPER TRADES ---");
  console.log("Waiting for buy signals...");
  console.log("\nPress Ctrl+C to stop monitoring");
}

// Run monitor every 5 seconds
setInterval(paperTradingMonitor, 5000);
paperTradingMonitor();
