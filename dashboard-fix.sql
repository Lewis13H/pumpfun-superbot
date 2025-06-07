// dashboard-fix.sql
-- Run these queries to fix common issues

-- 1. Ensure all tokens have required fields
UPDATE tokens 
SET price_change_1h = 0 
WHERE price_change_1h IS NULL;

UPDATE tokens 
SET market_cap = 0 
WHERE market_cap IS NULL;

UPDATE tokens 
SET volume_24h = 0 
WHERE volume_24h IS NULL;

-- 2. Ensure category is set
UPDATE tokens 
SET category = 'NEW' 
WHERE category IS NULL;

-- 3. Create any missing tables
CREATE TABLE IF NOT EXISTS timeseries.token_transactions (
  signature VARCHAR(88) NOT NULL,
  token_address VARCHAR(44) NOT NULL,
  time TIMESTAMPTZ NOT NULL,
  type VARCHAR(20) NOT NULL,
  user_address VARCHAR(44) NOT NULL,
  token_amount NUMERIC(40,0),
  sol_amount NUMERIC(40,0),
  price_usd NUMERIC(40,20),
  price_sol NUMERIC(40,20),
  slot BIGINT NOT NULL,
  fee BIGINT,
  PRIMARY KEY (signature, token_address, time)
);

-- 4. Add some test data if tables are empty
INSERT INTO timeseries.token_transactions (signature, token_address, time, type, user_address, token_amount, sol_amount, price_usd, price_sol, slot, fee)
SELECT 
  'test_' || generate_series AS signature,
  address AS token_address,
  NOW() - (generate_series || ' minutes')::INTERVAL AS time,
  CASE WHEN random() > 0.5 THEN 'buy' ELSE 'sell' END AS type,
  'test_user' AS user_address,
  1000000 AS token_amount,
  100000000 AS sol_amount,
  0.001 AS price_usd,
  0.00001 AS price_sol,
  123456 AS slot,
  5000 AS fee
FROM tokens
CROSS JOIN generate_series(1, 5) AS generate_series
WHERE EXISTS (SELECT 1 FROM tokens LIMIT 1)
LIMIT 10;