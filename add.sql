SELECT address, symbol, name, created_at FROM tokens ORDER BY created_at DESC LIMIT 10;

SELECT signature, token_address, time, type FROM timeseries.token_transactions WHERE type = 'create' ORDER BY time DESC LIMIT 10;

SELECT 
  (SELECT COUNT(*) FROM tokens WHERE created_at > NOW() - INTERVAL '1 hour') as tokens_1h,
  (SELECT COUNT(*) FROM timeseries.token_transactions WHERE type = 'create' AND time > NOW() - INTERVAL '1 hour') as creates_1h;