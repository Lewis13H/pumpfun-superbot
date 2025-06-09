-- DATABASE VERIFICATION & OPTIMIZATION
-- Run these queries to verify your price storage is working correctly

-- 1. Check if price data is being stored correctly
SELECT 
  token_address,
  COUNT(*) as price_count,
  MIN(time) as first_price,
  MAX(time) as latest_price,
  AVG(price_usd) as avg_price_usd,
  MIN(price_usd) as min_price,
  MAX(price_usd) as max_price
FROM timeseries.token_prices 
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY token_address
ORDER BY price_count DESC
LIMIT 10;

-- 2. Verify price calculation accuracy (check for outliers)
SELECT 
  token_address,
  time,
  price_usd,
  price_sol,
  market_cap,
  -- Calculate price from reserves to verify accuracy
  CASE 
    WHEN virtual_token_reserves::bigint > 0 
    THEN (virtual_sol_reserves::bigint / 1e9) / (virtual_token_reserves::bigint / 1e6)
    ELSE 0 
  END as calculated_price_sol,
  -- Check if stored price matches calculated price
  ABS(price_sol - (
    CASE 
      WHEN virtual_token_reserves::bigint > 0 
      THEN (virtual_sol_reserves::bigint / 1e9) / (virtual_token_reserves::bigint / 1e6)
      ELSE 0 
    END
  )) as price_difference
FROM timeseries.token_prices 
WHERE time > NOW() - INTERVAL '1 hour'
  AND price_usd > 0
ORDER BY price_difference DESC
LIMIT 20;

-- 3. Check for data quality issues
SELECT 
  'Zero prices' as issue_type,
  COUNT(*) as count
FROM timeseries.token_prices 
WHERE price_usd = 0 AND time > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Unrealistic high prices' as issue_type,
  COUNT(*) as count
FROM timeseries.token_prices 
WHERE price_usd > 1000 AND time > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Missing market cap' as issue_type,
  COUNT(*) as count
FROM timeseries.token_prices 
WHERE market_cap IS NULL AND time > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'Missing reserves data' as issue_type,
  COUNT(*) as count
FROM timeseries.token_prices 
WHERE (virtual_sol_reserves IS NULL OR virtual_token_reserves IS NULL) 
  AND time > NOW() - INTERVAL '24 hours';

-- 4. Performance check - average insertion rate
SELECT 
  DATE_TRUNC('hour', time) as hour,
  COUNT(*) as prices_inserted,
  COUNT(DISTINCT token_address) as unique_tokens,
  AVG(price_usd) as avg_price
FROM timeseries.token_prices 
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', time)
ORDER BY hour DESC;

-- 5. Check for duplicate entries (should be zero with proper conflicts handling)
SELECT 
  token_address,
  time,
  COUNT(*) as duplicate_count
FROM timeseries.token_prices 
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY token_address, time
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- 6. Verify SOL price history is being stored
SELECT 
  price,
  source,
  timestamp,
  timestamp - LAG(timestamp) OVER (ORDER BY timestamp) as time_gap
FROM sol_price_history 
ORDER BY timestamp DESC 
LIMIT 10;

-- 7. Check compression status (should be enabled for older data)
SELECT 
  chunk_schema,
  chunk_name,
  range_start,
  range_end,
  is_compressed,
  pg_size_pretty(total_bytes) as size,
  pg_size_pretty(compressed_total_bytes) as compressed_size
FROM timescaledb_information.chunks 
WHERE hypertable_name = 'token_prices'
ORDER BY range_start DESC
LIMIT 10;

-- 8. RECOMMENDED INDEXES for performance
-- Run these if they don't exist:

-- For token-specific price queries
CREATE INDEX IF NOT EXISTS idx_token_prices_token_time 
ON timeseries.token_prices (token_address, time DESC);

-- For recent price queries
CREATE INDEX IF NOT EXISTS idx_token_prices_time_desc 
ON timeseries.token_prices (time DESC);

-- For market cap analysis
CREATE INDEX IF NOT EXISTS idx_token_prices_market_cap 
ON timeseries.token_prices (market_cap DESC) 
WHERE market_cap > 0;

-- 9. OPTIMIZATION: Add continuous aggregates for common queries
-- Only run if not already created:

-- 1-minute candles
CREATE MATERIALIZED VIEW IF NOT EXISTS timeseries.token_candles_1m
WITH (timescaledb.continuous) AS
SELECT 
  time_bucket('1 minute', time) AS time,
  token_address,
  first(price_usd, time) AS open,
  max(price_usd) AS high,
  min(price_usd) AS low,
  last(price_usd, time) AS close,
  avg(price_usd) AS avg_price,
  count(*) AS ticks,
  last(market_cap, time) AS market_cap,
  last(liquidity_usd, time) AS liquidity
FROM timeseries.token_prices
GROUP BY time_bucket('1 minute', time), token_address;

-- Add refresh policy for 1-minute candles
SELECT add_continuous_aggregate_policy('timeseries.token_candles_1m',
    start_offset => INTERVAL '5 minutes',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- 10. VERIFICATION: Test price calculation matches stored data
-- This query should show very small differences (< 0.000001)
WITH price_verification AS (
  SELECT 
    token_address,
    time,
    price_sol as stored_price,
    CASE 
      WHEN virtual_token_reserves::bigint > 0 
      THEN (virtual_sol_reserves::bigint::numeric / 1e9) / (virtual_token_reserves::bigint::numeric / 1e6)
      ELSE 0 
    END as calculated_price,
    virtual_sol_reserves,
    virtual_token_reserves
  FROM timeseries.token_prices 
  WHERE time > NOW() - INTERVAL '1 hour'
    AND virtual_sol_reserves IS NOT NULL 
    AND virtual_token_reserves IS NOT NULL
    AND virtual_token_reserves::bigint > 0
    AND price_sol > 0
)
SELECT 
  token_address,
  COUNT(*) as records,
  AVG(ABS(stored_price - calculated_price)) as avg_difference,
  MAX(ABS(stored_price - calculated_price)) as max_difference,
  COUNT(*) FILTER (WHERE ABS(stored_price - calculated_price) > 0.000001) as significant_differences
FROM price_verification
GROUP BY token_address
HAVING COUNT(*) > 5
ORDER BY avg_difference DESC
LIMIT 20;