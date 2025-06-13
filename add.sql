-- Check column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tokens' 
AND column_name = 'pumpfun_address';

-- Count tokens with pump.fun addresses
SELECT COUNT(*) as total_tokens,
       COUNT(pumpfun_address) as with_pumpfun_address,
       COUNT(CASE WHEN pumpfun_address IS NOT NULL AND pumpfun_address != '' THEN 1 END) as valid_pumpfun
FROM tokens;

-- See some examples of dual addresses
SELECT address, pumpfun_address, symbol, market_cap, created_at
FROM tokens
WHERE pumpfun_address IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Check if any addresses end with 'pump'
SELECT address, pumpfun_address, symbol, market_cap
FROM tokens
WHERE address LIKE '%pump'
ORDER BY created_at DESC
LIMIT 10;

-- Show tokens where the address ends with 'pump' (pump.fun vanity addresses)
SELECT 
    address as pump_fun_id,
    pumpfun_address as bonding_curve,
    symbol,
    market_cap
FROM tokens
WHERE address LIKE '%pump'
ORDER BY created_at DESC
LIMIT 20;

-- See if any token addresses end with 'pump'
SELECT COUNT(*) as pump_addresses
FROM tokens
WHERE address LIKE '%pump';

-- Check create transactions
SELECT *
FROM timeseries.token_transactions
WHERE type = 'create'
AND (token_address LIKE '%pump' OR user_address LIKE '%pump')
LIMIT 10;

-- Check if bonding curves map to pump addresses
SELECT t1.address, t1.bonding_curve, t2.address as other_token
FROM tokens t1
JOIN tokens t2 ON t1.bonding_curve = t2.bonding_curve
WHERE t1.address != t2.address
LIMIT 10;

-- Check if ANY addresses in your database end with 'pump'
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN address LIKE '%pump' THEN 1 END) as pump_addresses,
    COUNT(CASE WHEN bonding_curve LIKE '%pump' THEN 1 END) as pump_bonding_curves
FROM tokens;

-- Check transaction addresses
SELECT DISTINCT 
    token_address,
    user_address,
    type
FROM timeseries.token_transactions
WHERE token_address LIKE '%pump' 
   OR user_address LIKE '%pump'
LIMIT 20;
SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN address LIKE '%pump' THEN 1 END) as pump_addresses,
    COUNT(CASE WHEN bonding_curve LIKE '%pump' THEN 1 END) as pump_bonding_curves
FROM tokens;

-- Check transaction addresses
SELECT DISTINCT 
    token_address,
    user_address,
    type
FROM timeseries.token_transactions
WHERE token_address LIKE '%pump' 
   OR user_address LIKE '%pump'
LIMIT 20;