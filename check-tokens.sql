SELECT address, symbol, category, market_cap, created_at 
FROM tokens 
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC 
LIMIT 10;
