// scripts/fix-bonding-curves.ts - Fix incorrectly stored bonding curves
import { db } from '../src/database/postgres';
import { Connection, PublicKey } from '@solana/web3.js';

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

async function fixBondingCurves() {
  console.log('\n=== Fixing Incorrect Bonding Curves ===\n');
  
  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  
  try {
    // Get all tokens with bonding curves
    const tokensWithBC = await db('tokens')
      .whereNotNull('bonding_curve')
      .select('address', 'symbol', 'bonding_curve');
    
    console.log(`Found ${tokensWithBC.length} tokens with bonding curves to check\n`);
    
    let fixedCount = 0;
    let errorCount = 0;
    let validCount = 0;
    
    for (const token of tokensWithBC) {
      try {
        // Check if the bonding curve is owned by System Program (incorrect)
        const bcPubkey = new PublicKey(token.bonding_curve);
        const accountInfo = await connection.getAccountInfo(bcPubkey);
        
        if (!accountInfo) {
          console.log(`❌ ${token.symbol}: Bonding curve doesn't exist on chain`);
          // Remove invalid bonding curve
          await db('tokens')
            .where('address', token.address)
            .update({
              bonding_curve: null,
              updated_at: new Date()
            });
          fixedCount++;
          continue;
        }
        
        const owner = accountInfo.owner.toBase58();
        
        if (owner === SYSTEM_PROGRAM) {
          console.log(`❌ ${token.symbol}: Bonding curve owned by System Program (incorrect)`);
          // Remove incorrect bonding curve
          await db('tokens')
            .where('address', token.address)
            .update({
              bonding_curve: null,
              updated_at: new Date()
            });
          fixedCount++;
        } else if (owner === PUMP_FUN_PROGRAM) {
          console.log(`✅ ${token.symbol}: Valid bonding curve`);
          validCount++;
        } else {
          console.log(`❓ ${token.symbol}: Bonding curve owned by unknown program: ${owner}`);
          errorCount++;
        }
        
      } catch (error) {
        console.error(`Error checking ${token.symbol}:`, error);
        errorCount++;
      }
      
      // Rate limit to avoid RPC limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n=== Summary ===');
    console.log(`Valid bonding curves: ${validCount}`);
    console.log(`Fixed (removed): ${fixedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    // Show current state
    const currentStats = await db('tokens')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('COUNT(CASE WHEN bonding_curve IS NOT NULL THEN 1 END) as with_bc'),
        db.raw('COUNT(CASE WHEN bonding_curve IS NULL THEN 1 END) as without_bc')
      )
      .first();
    
    console.log('\n=== Current Database State ===');
    console.log(`Total tokens: ${currentStats.total}`);
    console.log(`With bonding curves: ${currentStats.with_bc}`);
    console.log(`Without bonding curves: ${currentStats.without_bc}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await db.destroy();
  }
}

// Run the fix
fixBondingCurves();