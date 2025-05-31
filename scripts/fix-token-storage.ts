import { db } from '../src/database/postgres';

async function fixTokenStorage() {
  try {
    console.log('Fixing existing tokens with missing metadata...');
    
    // Get all tokens with raw_data but missing pump.fun fields
    const tokensToFix = await db('tokens')
      .whereNull('creator')
      .whereNotNull('raw_data')
      .where('platform', 'pumpfun');
    
    console.log(`Found ${tokensToFix.length} tokens to fix`);
    
    for (const token of tokensToFix) {
      try {
        const rawData = typeof token.raw_data === 'string' 
          ? JSON.parse(token.raw_data) 
          : token.raw_data;
        
        const updates: any = {};
        
        // Extract pump.fun specific data
        if (rawData.creator) updates.creator = rawData.creator;
        if (rawData.bondingCurve) updates.bonding_curve = rawData.bondingCurve;
        if (rawData.associatedBondingCurve) updates.associated_bonding_curve = rawData.associatedBondingCurve;
        if (rawData.creatorVault) updates.creator_vault = rawData.creatorVault;
        if (rawData.initialPrice) updates.initial_price_sol = rawData.initialPrice;
        if (rawData.initialSolAmount) updates.initial_liquidity_sol = rawData.initialSolAmount;
        if (rawData.marketCapSol) {
          const marketCapUSD = rawData.marketCapSol * 180; // Approximate SOL price
          updates.market_cap = marketCapUSD;
          updates.distance_to_graduation = 69420 - marketCapUSD;
        }
        
        // Mark as pump.fun token
        updates.is_pump_fun = true;
        
        if (Object.keys(updates).length > 0) {
          await db('tokens')
            .where('address', token.address)
            .update(updates);
          
          console.log(`Fixed ${token.symbol}: added ${Object.keys(updates).length} fields`);
        }
      } catch (error) {
        console.error(`Error fixing token ${token.address}:`, error);
      }
    }
    
    console.log('✅ Token metadata fix complete');
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

fixTokenStorage();
