// scripts/investigate-missing-bc.ts - Investigate why bonding curves are missing
import { db } from '../src/database/postgres';

async function investigateMissingBC() {
  console.log('\n=== Investigating Missing Bonding Curves ===\n');
  
  try {
    // 1. Check token transactions for patterns
    console.log('=== Token Creation Transactions ===');
    const createTxs = await db('timeseries.token_transactions')
      .where('type', 'create')
      .orderBy('time', 'desc')
      .limit(10)
      .select('token_address', 'signature', 'time');
    
    console.log(`Found ${createTxs.length} recent create transactions`);
    
    // 2. Check if these tokens have bonding curves in the tokens table
    if (createTxs.length > 0) {
      const tokenAddresses = createTxs.map(tx => tx.token_address);
      const tokensWithBC = await db('tokens')
        .whereIn('address', tokenAddresses)
        .whereNotNull('bonding_curve')
        .pluck('address');
      
      console.log(`\nOf these ${createTxs.length} tokens:`);
      console.log(`- ${tokensWithBC.length} have bonding curves`);
      console.log(`- ${createTxs.length - tokensWithBC.length} are missing bonding curves`);
      
      // Show details
      console.log('\nToken creation details:');
      for (const tx of createTxs.slice(0, 5)) {
        const token = await db('tokens')
          .where('address', tx.token_address)
          .first();
        
        console.log(`\nToken: ${tx.token_address.substring(0, 20)}...`);
        console.log(`- Created: ${new Date(tx.time).toLocaleString()}`);
        console.log(`- Has BC: ${token?.bonding_curve ? 'YES' : 'NO'}`);
        console.log(`- Discovery sig: ${token?.discovery_signature?.substring(0, 20) || 'N/A'}...`);
      }
    }
    
    // 3. Check recent tokens without BC but with price updates
    console.log('\n=== Anomaly Check ===');
    const anomalies = await db('tokens as t')
      .whereNull('t.bonding_curve')
      .whereExists(
        db('timeseries.token_prices')
          .whereRaw('token_address = t.address')
      )
      .select('t.address', 't.symbol', 't.created_at')
      .limit(5);
    
    if (anomalies.length > 0) {
      console.log(`\nFound ${anomalies.length} tokens WITHOUT bonding curves but WITH price updates!`);
      console.log('This suggests bonding curves are being monitored but not saved.');
      
      console.table(anomalies.map(t => ({
        address: t.address.substring(0, 20) + '...',
        symbol: t.symbol,
        created: new Date(t.created_at).toLocaleString()
      })));
    } else {
      console.log('\nNo anomalies found - tokens without BC also have no prices.');
    }
    
    // 4. Check if bonding curve field is being updated
    console.log('\n=== Recent Bonding Curve Updates ===');
    const recentBCUpdates = await db('tokens')
      .whereNotNull('bonding_curve')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('address', 'bonding_curve', 'created_at', 'updated_at');
    
    if (recentBCUpdates.length > 0) {
      console.log(`Found ${recentBCUpdates.length} tokens with bonding curves in last hour`);
      console.table(recentBCUpdates.map(t => ({
        token: t.address.substring(0, 10) + '...',
        bonding_curve: t.bonding_curve.substring(0, 20) + '...',
        created: new Date(t.created_at).toLocaleString(),
        updated: new Date(t.updated_at).toLocaleString()
      })));
    } else {
      console.log('No tokens with bonding curves found in last hour!');
    }
    
  } catch (error) {
    console.error('Investigation error:', error);
  } finally {
    await db.destroy();
  }
}

// Run investigation
investigateMissingBC();