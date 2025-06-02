// This shows how the price should be assigned in handleTokenDiscovery

// After getting DexScreener data:
if (pairs && pairs.length > 0) {
  const pair = pairs[0];
  marketData = {
    marketCap: parseFloat(pair.fdv?.toString() || '0'),
    price: parseFloat(pair.priceUsd?.toString() || '0'),  // <-- This becomes current_price
    liquidity: parseFloat(pair.liquidity?.toString() || '0'),
    volume24h: parseFloat(pair.volume24h?.toString() || '0')
  };
}

// When saving to database:
await db('tokens').insert({
  // ... other fields ...
  
  // Market data
  market_cap: marketData.marketCap,
  current_price: marketData.price,  // <-- Make sure this line exists
  liquidity: marketData.liquidity,
  volume_24h: marketData.volume24h,
  
  // ... rest of fields ...
});
