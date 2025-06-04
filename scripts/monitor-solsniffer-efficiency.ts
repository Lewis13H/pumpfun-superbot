import { db } from "../src/database/postgres";
import { buySignalEvaluator } from "../src/trading/buy-signal-evaluator";

async function monitorEfficiency() {
  console.clear();
  console.log("=== SOLSNIFFER EFFICIENCY MONITOR ===\n");
  
  // Get AIM tokens
  const aimTokens = await db("tokens")
    .where("category", "AIM")
    .select("*");
    
  console.log(`AIM Tokens: ${aimTokens.length}\n`);
  
  for (const token of aimTokens) {
    console.log(`${token.symbol}:`);
    console.log(`  Market Cap: $${token.market_cap} ✓`);
    console.log(`  Liquidity: $${token.liquidity} ${token.liquidity >= 7500 ? "✓" : "✗"}`);
    console.log(`  Holders: ${token.holders} ${token.holders >= 50 ? "✓" : "✗"}`);
    console.log(`  Top 10%: ${token.top_10_percent}% ${token.top_10_percent < 25 ? "✓" : "✗"}`);
    console.log(`  SolSniffer: ${token.solsniffer_score || "N/A"}`);
    
    // Check if would pass without SolSniffer
    const wouldPassBasic = 
      token.market_cap >= 35000 && token.market_cap <= 105000 &&
      token.liquidity >= 7500 &&
      token.holders >= 50 &&
      token.top_10_percent < 25;
      
    if (wouldPassBasic) {
      console.log(`  → Would pass basic criteria! SolSniffer check needed.`);
    } else {
      console.log(`  → Fails basic criteria. No SolSniffer needed.`);
    }
    
    // Check last SolSniffer call
    if (token.solsniffer_checked_at) {
      const hoursSince = (Date.now() - new Date(token.solsniffer_checked_at).getTime()) / (1000 * 60 * 60);
      console.log(`  Last checked: ${hoursSince.toFixed(1)}h ago`);
    }
    
    console.log("");
  }
  
  // Calculate potential savings
  const passBasicCount = aimTokens.filter(t => 
    t.liquidity >= 7500 && 
    t.holders >= 50 && 
    t.top_10_percent < 25
  ).length;
  
  console.log("Efficiency Analysis:");
  console.log(`  Tokens passing basic criteria: ${passBasicCount}/${aimTokens.length}`);
  console.log(`  Potential SolSniffer calls/hour: ${passBasicCount}`);
  console.log(`  Current approach: ${aimTokens.length * 12} calls/hour`);
  console.log(`  Savings: ${((1 - passBasicCount/(aimTokens.length * 12)) * 100).toFixed(1)}%`);
}

monitorEfficiency().catch(console.error);
