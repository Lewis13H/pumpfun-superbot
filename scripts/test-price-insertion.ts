// scripts/test-price-insertion.ts - Test inserting prices directly
import { db } from '../src/database/postgres';

async function testPriceInsertion() {
  console.log('\n=== Testing Price Insertion ===\n');
  
  try {
    // 1. Get a token that has a bonding curve
    const tokenWithCurve = await db('tokens')
      .whereNotNull('bonding_curve')
      .orderBy('created_at', 'desc')
      .first();
    
    if (!tokenWithCurve) {
      console.log('No tokens with bonding curves found!');
      
      // Get any recent token instead
      const anyToken = await db('tokens')
        .orderBy('created_at', 'desc')
        .first();
      
      if (!anyToken) {
        console.log('No tokens found at all!');
        return;
      }
      
      console.log(`Using token without bonding curve: ${anyToken.address} (${anyToken.symbol})`);
      tokenWithCurve = anyToken;
    } else {
      console.log(`Testing with token: ${tokenWithCurve.address} (${tokenWithCurve.symbol})`);
      console.log(`Bonding curve: ${tokenWithCurve.bonding_curve}`);
    }
    
    // 2. Check if it has any prices
    const priceCount = await db('timeseries.token_prices')
      .where('token_address', tokenWithCurve.address)
      .count('* as count');
    
    console.log(`Current price records: ${priceCount[0].count}`);
    
    // 3. Try to insert a test price
    const testPrice = {
      token_address: tokenWithCurve.address,
      time: new Date(),
      price_usd: 0.000123,
      price_sol: 0.0000012,
      virtual_sol_reserves: '1000000000',
      virtual_token_reserves: '1000000000000',
      real_sol_reserves: '500000000',
      real_token_reserves: '500000000000',
      market_cap: 123.45,
      liquidity_usd: 100.00,
      slot: 999999,
      source: 'test'
    };
    
    console.log('\nInserting test price...');
    
    try {
      await db('timeseries.token_prices').insert(testPrice);
      console.log('✅ Price inserted successfully!');
      
      // Verify it was inserted
      const inserted = await db('timeseries.token_prices')
        .where('token_address', tokenWithCurve.address)
        .where('source', 'test')
        .first();
      
      if (inserted) {
        console.log('✅ Price verified in database');
        console.log(`Price USD: ${inserted.price_usd}`);
        console.log(`Market Cap: ${inserted.market_cap}`);
      }
      
    } catch (error: any) {
      console.error('❌ Failed to insert price:', error.message);
      console.log('\nError details:', {
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      });
    }
    
    // 4. Check token_prices table structure
    console.log('\n=== Checking Table Structure ===');
    const columns = await db.raw(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'timeseries' 
      AND table_name = 'token_prices'
      ORDER BY ordinal_position
    `);
    
    console.log('\ntoken_prices columns:');
    console.table(columns.rows);
    
    // 5. Check if there are any constraints
    const constraints = await db.raw(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'timeseries' 
      AND table_name = 'token_prices'
    `);
    
    console.log('\nConstraints:');
    console.table(constraints.rows);
    
    // 6. Check for tokens with no bonding curve
    const tokensNoBonding = await db('tokens')
      .whereNull('bonding_curve')
      .count('* as count');
    
    console.log(`\nTokens without bonding curves: ${tokensNoBonding[0].count}`);
    
    // 7. Check recent tokens and their status
    const recentTokens = await db('tokens')
      .select('address', 'symbol', 'bonding_curve', 'created_at', 'last_price_update')
      .orderBy('created_at', 'desc')
      .limit(10);
    
    console.log('\nRecent tokens:');
    console.table(recentTokens.map(t => ({
      address: t.address.substring(0, 20) + '...',
      symbol: t.symbol,
      has_bonding_curve: !!t.bonding_curve,
      has_price_update: !!t.last_price_update,
      created: new Date(t.created_at).toLocaleString()
    })));
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await db.destroy();
  }
}

// Run the test
testPriceInsertion();