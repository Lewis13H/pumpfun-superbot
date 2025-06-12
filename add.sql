-- Migration: Add archive tracking columns and GRADUATED category
-- Run this migration to update your database schema

-- 1. Add new columns to tokens table
ALTER TABLE public.tokens
ADD COLUMN IF NOT EXISTS first_seen_above_8k TIMESTAMP,
ADD COLUMN IF NOT EXISTS below_8k_since TIMESTAMP,
ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(50),
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

-- 2. Create index for archive job queries
CREATE INDEX IF NOT EXISTS idx_tokens_below_8k_since 
ON public.tokens(below_8k_since) 
WHERE below_8k_since IS NOT NULL 
  AND category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE');

-- 3. Create index for market cap queries
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap_active
ON public.tokens(market_cap)
WHERE category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE');

-- 4. Update existing 'NEW' tokens based on their market cap
-- This recategorizes existing tokens according to new thresholds
UPDATE public.tokens
SET 
  category = CASE
    WHEN market_cap < 8000 THEN category  -- Keep current category if below $8k
    WHEN market_cap < 15000 THEN 'LOW'
    WHEN market_cap < 25000 THEN 'MEDIUM'
    WHEN market_cap < 35000 THEN 'HIGH'
    WHEN market_cap < 105000 THEN 'AIM'
    ELSE 'GRADUATED'
  END,
  updated_at = NOW()
WHERE category = 'NEW' 
  AND market_cap IS NOT NULL
  AND market_cap >= 8000;

-- 5. Set below_8k_since for tokens currently below $8k
UPDATE public.tokens
SET 
  below_8k_since = NOW(),
  updated_at = NOW()
WHERE market_cap < 8000 
  AND market_cap > 0
  AND below_8k_since IS NULL
  AND category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE');

-- 6. Archive tokens that don't meet the new $8k minimum and have been inactive
-- Archive tokens below $8k that haven't been updated in 48 hours
UPDATE public.tokens
SET 
  category = 'ARCHIVE',
  archive_reason = 'below_minimum_threshold',
  archived_at = NOW(),
  updated_at = NOW()
WHERE market_cap < 8000 
  AND last_price_update < NOW() - INTERVAL '48 hours'
  AND category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE');

-- 7. Add check constraint to ensure graduated tokens have proper market cap
ALTER TABLE public.tokens 
DROP CONSTRAINT IF EXISTS check_graduated_market_cap;

ALTER TABLE public.tokens
ADD CONSTRAINT check_graduated_market_cap 
CHECK (
  category != 'GRADUATED' OR market_cap > 105000 OR market_cap IS NULL
);

-- 8. Update category enum in any relevant check constraints
-- Note: If you have enum types, update them to include 'GRADUATED'

-- 9. Create a summary view for monitoring
CREATE OR REPLACE VIEW token_category_summary AS
SELECT 
  category,
  COUNT(*) as token_count,
  AVG(market_cap) as avg_market_cap,
  MIN(market_cap) as min_market_cap,
  MAX(market_cap) as max_market_cap,
  COUNT(CASE WHEN below_8k_since IS NOT NULL THEN 1 END) as tokens_below_threshold,
  COUNT(CASE WHEN archive_reason IS NOT NULL THEN 1 END) as archived_tokens
FROM public.tokens
GROUP BY category
ORDER BY 
  CASE category
    WHEN 'LOW' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'HIGH' THEN 3
    WHEN 'AIM' THEN 4
    WHEN 'GRADUATED' THEN 5
    WHEN 'ARCHIVE' THEN 6
    WHEN 'BIN' THEN 7
    WHEN 'COMPLETE' THEN 8
    ELSE 9
  END;

-- 10. Add function to get tokens pending archive
CREATE OR REPLACE FUNCTION get_tokens_pending_archive()
RETURNS TABLE (
  address VARCHAR(44),
  symbol VARCHAR(20),
  name VARCHAR(100),
  market_cap DECIMAL(30,2),
  category VARCHAR(20),
  below_8k_since TIMESTAMP,
  hours_below_threshold NUMERIC,
  hours_until_archive NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.address,
    t.symbol,
    t.name,
    t.market_cap,
    t.category,
    t.below_8k_since,
    EXTRACT(EPOCH FROM (NOW() - t.below_8k_since)) / 3600 AS hours_below_threshold,
    48 - (EXTRACT(EPOCH FROM (NOW() - t.below_8k_since)) / 3600) AS hours_until_archive
  FROM public.tokens t
  WHERE t.below_8k_since IS NOT NULL
    AND t.category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE')
    AND t.market_cap < 8000
  ORDER BY t.below_8k_since ASC;
END;
$$ LANGUAGE plpgsql;

-- 11. Grant necessary permissions (adjust user as needed)
-- GRANT SELECT ON token_category_summary TO memecoin_user;
-- GRANT EXECUTE ON FUNCTION get_tokens_pending_archive() TO memecoin_user;