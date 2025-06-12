-- Quick SQL migration script to update NEW category tokens
-- Run this directly in PostgreSQL if needed
-- 
-- Usage: psql -U memecoin_user -d memecoin_discovery -f migrations/sql/001_migrate_new_tokens.sql

-- First, check how many NEW tokens exist
SELECT COUNT(*) as new_token_count 
FROM public.tokens 
WHERE category = 'NEW';

-- Begin migration transaction
BEGIN;

-- Update NEW tokens to appropriate categories based on market cap
UPDATE public.tokens
SET 
  category = CASE
    WHEN market_cap < 8000 THEN 'ARCHIVE'
    WHEN market_cap >= 8000 AND market_cap < 15000 THEN 'LOW'
    WHEN market_cap >= 15000 AND market_cap < 25000 THEN 'MEDIUM'
    WHEN market_cap >= 25000 AND market_cap < 35000 THEN 'HIGH'
    WHEN market_cap >= 35000 AND market_cap < 105000 THEN 'AIM'
    WHEN market_cap >= 105000 THEN 'GRADUATED'
    ELSE 'LOW' -- Default to LOW if market_cap is NULL
  END,
  updated_at = NOW()
WHERE category = 'NEW';

-- Log all transitions for audit trail
INSERT INTO category_transitions (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
SELECT 
  address,
  'NEW' as from_category,
  CASE
    WHEN market_cap < 8000 THEN 'ARCHIVE'
    WHEN market_cap >= 8000 AND market_cap < 15000 THEN 'LOW'
    WHEN market_cap >= 15000 AND market_cap < 25000 THEN 'MEDIUM'
    WHEN market_cap >= 25000 AND market_cap < 35000 THEN 'HIGH'
    WHEN market_cap >= 35000 AND market_cap < 105000 THEN 'AIM'
    WHEN market_cap >= 105000 THEN 'GRADUATED'
    ELSE 'LOW'
  END as to_category,
  COALESCE(market_cap, 0) as market_cap_at_transition,
  'migration_from_new_category' as reason,
  NOW() as created_at
FROM public.tokens
WHERE category = 'NEW';

-- Show migration summary
SELECT 
  'Migration Summary' as info,
  COUNT(*) as tokens_migrated
FROM public.tokens
WHERE category = 'NEW';

-- Show distribution after migration
SELECT 
  CASE
    WHEN market_cap < 8000 THEN 'ARCHIVE'
    WHEN market_cap >= 8000 AND market_cap < 15000 THEN 'LOW'
    WHEN market_cap >= 15000 AND market_cap < 25000 THEN 'MEDIUM'
    WHEN market_cap >= 25000 AND market_cap < 35000 THEN 'HIGH'
    WHEN market_cap >= 35000 AND market_cap < 105000 THEN 'AIM'
    WHEN market_cap >= 105000 THEN 'GRADUATED'
    ELSE 'LOW'
  END as new_category,
  COUNT(*) as token_count
FROM public.tokens
WHERE category = 'NEW'
GROUP BY 1
ORDER BY 2 DESC;

-- Commit the transaction
COMMIT;

-- Verify no NEW tokens remain
SELECT COUNT(*) as remaining_new_tokens 
FROM public.tokens 
WHERE category = 'NEW';

-- Show current category distribution
SELECT 
  category,
  COUNT(*) as token_count,
  AVG(market_cap)::numeric(10,2) as avg_market_cap,
  MIN(market_cap)::numeric(10,2) as min_market_cap,
  MAX(market_cap)::numeric(10,2) as max_market_cap
FROM public.tokens
GROUP BY category
ORDER BY 
  CASE category
    WHEN 'ARCHIVE' THEN 1
    WHEN 'LOW' THEN 2
    WHEN 'MEDIUM' THEN 3
    WHEN 'HIGH' THEN 4
    WHEN 'AIM' THEN 5
    WHEN 'GRADUATED' THEN 6
    ELSE 7
  END;

-- Show recent transitions from NEW
SELECT 
  token_address,
  from_category,
  to_category,
  market_cap_at_transition,
  created_at
FROM category_transitions
WHERE from_category = 'NEW'
ORDER BY created_at DESC
LIMIT 10;

-- Optional: Add constraint to prevent NEW category in future
-- UNCOMMENT TO ADD CONSTRAINT:
-- ALTER TABLE public.tokens 
-- ADD CONSTRAINT valid_category 
-- CHECK (category IN ('LOW', 'MEDIUM', 'HIGH', 'AIM', 'GRADUATED', 'ARCHIVE'));