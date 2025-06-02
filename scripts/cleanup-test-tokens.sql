-- Remove test tokens
DELETE FROM tokens WHERE address LIKE 'TEST%' OR address LIKE 'LOAD_TEST_%';

-- Show recent real tokens
SELECT symbol, category, market_cap, current_price, platform, discovered_at 
FROM tokens 
WHERE discovered_at > NOW() - INTERVAL '10 minutes'
ORDER BY discovered_at DESC
LIMIT 10;
