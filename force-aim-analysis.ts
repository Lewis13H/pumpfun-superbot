import { categoryAPIRouter } from "./src/analysis/category-api-router";
import { db } from "./src/database/postgres";

async function forceAimAnalysis() {
  const aimTokens = await db("tokens")
    .where("category", "AIM")
    .select("address", "symbol");
    
  console.log(`Forcing full analysis for ${aimTokens.length} AIM tokens...`);
  
  for (const token of aimTokens) {
    console.log(`\nAnalyzing ${token.symbol}...`);
    try {
      const result = await categoryAPIRouter.analyzeToken(
        token.address,
        "AIM",
        true // force full analysis
      );
      console.log(`  Market Cap: $${result.marketCap}`);
      console.log(`  Liquidity: $${result.liquidity}`);
      console.log(`  SolSniffer: ${result.solsnifferScore || "Failed"}`);
      console.log(`  APIs used: ${result.apisUsed.join(", ")}`);
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }
}

forceAimAnalysis().catch(console.error);
