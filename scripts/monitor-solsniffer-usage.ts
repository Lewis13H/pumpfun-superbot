import { db } from "../src/database/postgres";

async function monitorSolSnifferUsage() {
  console.clear();
  console.log("=== SOLSNIFFER USAGE MONITOR ===\n");
  
  // Today's usage
  const todayUsage = await db("api_call_logs")
    .where("service", "solsniffer")
    .where("timestamp", ">", new Date(new Date().setHours(0,0,0,0)))
    .select(
      db.raw("COUNT(*) as calls"),
      db.raw("COUNT(DISTINCT token_address) as unique_tokens"),
      db.raw("SUM(cost) as total_cost")
    )
    .first();
    
  console.log("Today's Usage:");
  console.log(`  Total Calls: ${todayUsage.calls}`);
  console.log(`  Unique Tokens: ${todayUsage.unique_tokens}`);
  console.log(`  Cost: $${Number(todayUsage.total_cost).toFixed(2)}`);
  
  // Hourly breakdown
  const hourlyUsage = await db("api_call_logs")
    .where("service", "solsniffer")
    .where("timestamp", ">", new Date(Date.now() - 6 * 60 * 60 * 1000))
    .select(
      db.raw("DATE_TRUNC('hour', timestamp) as hour"),
      db.raw("COUNT(*) as calls")
    )
    .groupBy("hour")
    .orderBy("hour", "desc");
    
  console.log("\nLast 6 Hours:");
  hourlyUsage.forEach(h => {
    const hour = new Date(h.hour).toLocaleTimeString();
    console.log(`  ${hour}: ${h.calls} calls`);
  });
  
  // Top consuming tokens
  const topTokens = await db("api_call_logs as a")
    .join("tokens as t", "a.token_address", "t.address")
    .where("a.service", "solsniffer")
    .where("a.timestamp", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
    .select("t.symbol", "t.category")
    .count("* as calls")
    .groupBy("t.symbol", "t.category")
    .orderBy("calls", "desc")
    .limit(10);
    
  console.log("\nTop Consuming Tokens (24h):");
  topTokens.forEach(t => {
    console.log(`  ${t.symbol} (${t.category}): ${t.calls} calls`);
  });
  
  // Cost projection
  const avgCallsPerHour = todayUsage.calls / (new Date().getHours() || 1);
  const projectedDailyCalls = avgCallsPerHour * 24;
  const projectedCost = projectedDailyCalls * 0.01;
  
  console.log("\nProjections:");
  console.log(`  Daily Calls: ${Math.round(projectedDailyCalls)}`);
  console.log(`  Daily Cost: $${projectedCost.toFixed(2)}`);
  console.log(`  Monthly Cost: $${(projectedCost * 30).toFixed(2)}`);
}

monitorSolSnifferUsage().catch(console.error);
