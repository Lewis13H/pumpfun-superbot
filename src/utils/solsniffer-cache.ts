import { categoryConfig } from "../config/category-config";
import { db } from "../database/postgres";

export async function shouldCheckSolSniffer(tokenAddress: string): Promise<boolean> {
  // Get token details
  const token = await db("tokens")
    .where("address", tokenAddress)
    .first();
    
  if (!token) return false;
  
  // Only check AIM tokens
  if (token.category !== "AIM") {
    console.log(`Skipping SolSniffer for ${token.symbol} - not in AIM (${token.category})`);
    return false;
  }
  
  // Check if recently checked
  if (token.solsniffer_checked_at) {
    const hoursSinceCheck = (Date.now() - new Date(token.solsniffer_checked_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCheck < 6) {
      console.log(`Skipping SolSniffer for ${token.symbol} - checked ${hoursSinceCheck.toFixed(1)} hours ago`);
      return false;
    }
  }
  
  // Check daily limit
  const todaysCalls = await db("api_call_logs")
    .where("service", "solsniffer")
    .where("token_address", tokenAddress)
    .where("timestamp", ">", new Date(new Date().setHours(0,0,0,0)))
    .count("* as count")
    .first();
    
  // Fix: Handle undefined and convert count to number
  const callCount = todaysCalls ? Number(todaysCalls.count) : 0;
  
  if (callCount >= 1) {
    console.log(`Skipping SolSniffer for ${token.symbol} - already checked today`);
    return false;
  }
  
  return true;
}