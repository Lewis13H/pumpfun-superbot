// scripts/diagnose-bonding-curves.ts - Check bonding curve detection
import { db } from '../src/database/postgres';

async function diagnoseBondingCurves() {
  console.log('\n=== Diagnosing Bonding Curve Detection ===\n');
  
  try {
    // 1. Overall stats
    const totalTokensResult = await db('tokens').count('* as count');
    const tokensWithBCResult = await db('tokens').whereNotNull('bonding_curve').count('* as count');
    const tokensWithoutBCResult = await db('tokens').whereNull('bonding_curve').count('* as count');
    
    const totalCount = parseInt(totalTokensResult[0].count as string);
    const withBCCount = parseInt(tokensWithBCResult[0].count as string);
    const withoutBCCount = parseInt(tokensWithoutBCResult[0].count as string);
    
    console.log('=== Overall Stats ===');
    console.log(`Total tokens: ${totalCount}`);
    console.log(`Tokens WITH bonding curves: ${withBCCount} (${(withBCCount / totalCount * 100).toFixed(1)}%)`);
    console.log(`Tokens WITHOUT bonding curves: ${withoutBCCount} (${(withoutBCCount / totalCount * 100).toFixed(1)}%)`);
    
    // 2. Recent tokens breakdown
    console.log('\n=== Last 24 Hours ===');
    const last24h = await db('tokens')
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('COUNT(CASE WHEN bonding_curve IS NOT NULL THEN 1 END) as with_bc'),
        db.raw('COUNT(CASE WHEN bonding_curve IS NULL THEN 1 END) as without_bc')
      )
      .first();
    
    const last24hTotal = parseInt(last24h.total);
    const last24hWithBC = parseInt(last24h.with_bc);
    const last24hWithoutBC = parseInt(last24h.without_bc);
    
    console.log(`Total: ${last24hTotal}`);
    console.log(`With BC: ${last24hWithBC} (${last24hTotal > 0 ? (last24hWithBC / last24hTotal * 100).toFixed(1) : 0}%)`);
    console.log(`Without BC: ${last24hWithoutBC} (${last24hTotal > 0 ? (last24hWithoutBC / last24hTotal * 100).toFixed(1) : 0}%)`);
    
    // 3. Tokens with bonding curves - do they have prices?
    console.log('\n=== Tokens WITH Bonding Curves ===');
    const bcTokensWithPrices = await db('tokens as t')
      .whereNotNull('t.bonding_curve')
      .leftJoin(
        db('timeseries.token_prices')
          .select('token_address')
          .count('* as price_count')
          .groupBy('token_address')
          .as('tp'),
        't.address',
        'tp.token_address'
      )
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('COUNT(CASE WHEN tp.price_count > 0 THEN 1 END) as with_prices'),
        db.raw('COUNT(CASE WHEN tp.price_count IS NULL OR tp.price_count = 0 THEN 1 END) as without_prices')
      )
      .first();
    
    const bcTotal = parseInt(bcTokensWithPrices.total);
    const bcWithPrices = parseInt(bcTokensWithPrices.with_prices);
    const bcWithoutPrices = parseInt(bcTokensWithPrices.without_prices);
    
    console.log(`Total with BC: ${bcTotal}`);
    console.log(`Have price data: ${bcWithPrices} (${bcTotal > 0 ? (bcWithPrices / bcTotal * 100).toFixed(1) : 0}%)`);
    console.log(`NO price data: ${bcWithoutPrices} (${bcTotal > 0 ? (bcWithoutPrices / bcTotal * 100).toFixed(1) : 0}%)`);
    
    // 4. Sample tokens without bonding curves
    console.log('\n=== Sample Tokens WITHOUT Bonding Curves ===');
    const sampleWithoutBC = await db('tokens')
      .whereNull('bonding_curve')
      .orderBy('created_at', 'desc')
      .limit(5)
      .select('address', 'symbol', 'created_at', 'discovery_signature');
    
    console.table(sampleWithoutBC.map(t => ({
      address: t.address.substring(0, 20) + '...',
      symbol: t.symbol,
      created: new Date(t.created_at).toLocaleString(),
      discovery_sig: t.discovery_signature ? t.discovery_signature.substring(0, 20) + '...' : 'N/A'
    })));
    
    // 5. Sample tokens with bonding curves but no prices
    console.log('\n=== Sample Tokens WITH BC but NO Prices ===');
    const tokensWithBCNoPrices = await db('tokens as t')
      .whereNotNull('t.bonding_curve')
      .whereNotExists(
        db('timeseries.token_prices')
          .whereRaw('token_address = t.address')
      )
      .orderBy('t.created_at', 'desc')
      .limit(5)
      .select('t.address', 't.symbol', 't.bonding_curve', 't.created_at');
    
    if (tokensWithBCNoPrices.length > 0) {
      console.table(tokensWithBCNoPrices.map(t => ({
        address: t.address.substring(0, 20) + '...',
        symbol: t.symbol,
        bonding_curve: t.bonding_curve.substring(0, 20) + '...',
        created: new Date(t.created_at).toLocaleString()
      })));
    } else {
      console.log('None found - all tokens with BC have prices!');
    }
    
    // 6. Check if bonding curves are being tracked
    console.log('\n=== Bonding Curve Addresses ===');
    const uniqueBondingCurvesResult = await db('tokens')
      .whereNotNull('bonding_curve')
      .countDistinct('bonding_curve as count');
    
    const uniqueBCCount = parseInt(uniqueBondingCurvesResult[0].count as string);
    console.log(`Unique bonding curve addresses: ${uniqueBCCount}`);
    
    // 7. Recent price activity
    console.log('\n=== Recent Price Activity ===');
    const priceActivity = await db('timeseries.token_prices')
      .where('time', '>', db.raw("NOW() - INTERVAL '1 hour'"))
      .select(
        db.raw('COUNT(DISTINCT token_address) as unique_tokens'),
        db.raw('COUNT(*) as total_updates'),
        db.raw('MIN(time) as first_update'),
        db.raw('MAX(time) as last_update')
      )
      .first();
    
    console.log(`Tokens with price updates in last hour: ${priceActivity.unique_tokens || 0}`);
    console.log(`Total price updates: ${priceActivity.total_updates || 0}`);
    console.log(`First update: ${priceActivity.first_update ? new Date(priceActivity.first_update).toLocaleString() : 'N/A'}`);
    console.log(`Last update: ${priceActivity.last_update ? new Date(priceActivity.last_update).toLocaleString() : 'N/A'}`);
    
  } catch (error) {
    console.error('Diagnostic error:', error);
  } finally {
    await db.destroy();
  }
}

// Run diagnostics
diagnoseBondingCurves();