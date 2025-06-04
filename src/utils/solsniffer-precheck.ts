import { db } from "../database/postgres";
import { categoryConfig } from "../config/category-config";

export async function needsSolSnifferCheck(tokenAddress: string): Promise<boolean> {
  // Get token data
  const token = await db("tokens")
    .where("address", tokenAddress)
    .first();
    
  if (!token || token.category !== "AIM") return false;
  
  const criteria = categoryConfig.buySignalCriteria;
  
  // Check basic criteria first (these are free/cheap)
  const basicCriteriaMet = 
    token.market_cap >= criteria.marketCap.min &&
    token.market_cap <= criteria.marketCap.max &&
    token.liquidity >= criteria.liquidity.min &&
    (token.holders ? token.holders >= criteria.holders.min : true) &&
    (token.top_10_percent !== null ? token.top_10_percent < criteria.top10Concentration.max : true);
    
  if (!basicCriteriaMet) {
    console.log(`Token ${token.symbol} fails basic criteria - skipping SolSniffer`);
    return false;
  }
  
  // If basic criteria pass, check SolSniffer cache
  if (token.solsniffer_checked_at) {
    const hoursSinceCheck = (Date.now() - new Date(token.solsniffer_checked_at).getTime()) / (1000 * 60 * 60);
    
    // If checked within 1 hour and score is known bad, skip
    if (hoursSinceCheck < 1) {
      if (token.solsniffer_score <= 60 || token.solsniffer_score === 90) {
        console.log(`Token ${token.symbol} has recent bad SolSniffer score (${token.solsniffer_score}) - skipping`);
        return false;
      }
    }
    
    // If checked within 1 hour and score is good, also skip (use cache)
    if (hoursSinceCheck < 1 && token.solsniffer_score > 60 && token.solsniffer_score !== 90) {
      console.log(`Token ${token.symbol} has recent good SolSniffer score (${token.solsniffer_score}) - using cache`);
      return false;
    }
  }
  
  console.log(`Token ${token.symbol} needs SolSniffer check`);
  return true;
}