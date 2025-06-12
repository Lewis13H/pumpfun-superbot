-- Fix existing NEW tokens by recategorizing them based on market cap
UPDATE public.tokens
SET 
  category = CASE
    WHEN market_cap IS NULL OR market_cap < 8000 THEN 'ARCHIVE'  -- Archive if below $8k or no market cap
    WHEN market_cap < 15000 THEN 'LOW'
    WHEN market_cap < 25000 THEN 'MEDIUM'
    WHEN market_cap < 35000 THEN 'HIGH'
    WHEN market_cap < 105000 THEN 'AIM'
    ELSE 'GRADUATED'
  END,
  category_updated_at = NOW(),
  archive_reason = CASE 
    WHEN market_cap IS NULL OR market_cap < 8000 THEN 'legacy_below_threshold'
    ELSE NULL
  END,
  archived_at = CASE 
    WHEN market_cap IS NULL OR market_cap < 8000 THEN NOW()
    ELSE NULL
  END,
  updated_at = NOW()
WHERE category = 'NEW';

-- Also set below_8k_since for any tokens currently below $8k
UPDATE public.tokens
SET 
  below_8k_since = COALESCE(below_8k_since, NOW()),
  updated_at = NOW()
WHERE market_cap < 8000 
  AND market_cap > 0
  AND below_8k_since IS NULL
  AND category NOT IN ('ARCHIVE', 'BIN', 'COMPLETE');

-- Check results
SELECT category, COUNT(*) as count 
FROM tokens 
GROUP BY category 
ORDER BY category;