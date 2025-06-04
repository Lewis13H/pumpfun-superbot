-- Migration: Fix numeric overflow issues
-- Version: 002
-- Date: 2025-06-04

BEGIN;

-- Check current column types
SELECT column_name, data_type, numeric_precision, numeric_scale 
FROM information_schema.columns 
WHERE table_name = 'tokens' 
AND column_name IN ('top_10_percent', 'current_price', 'market_cap', 'liquidity', 'volume_24h');

-- Fix top_10_percent to ensure it can store percentages properly
-- DECIMAL(5,2) can only store up to 999.99, but we only need 0-100
-- Let's be safe and use DECIMAL(6,2) which can store up to 9999.99
ALTER TABLE tokens 
ALTER COLUMN top_10_percent TYPE DECIMAL(6,2);

-- Also check and fix other numeric columns if needed
-- Market cap, liquidity, and volume can be very large numbers
ALTER TABLE tokens 
ALTER COLUMN market_cap TYPE DECIMAL(20,2);

ALTER TABLE tokens 
ALTER COLUMN liquidity TYPE DECIMAL(20,2);

ALTER TABLE tokens 
ALTER COLUMN volume_24h TYPE DECIMAL(20,2);

-- Current price needs high precision for small values
ALTER TABLE tokens 
ALTER COLUMN current_price TYPE DECIMAL(30,18);

-- Update migration tracking
INSERT INTO schema_migrations (version) VALUES ('002_fix_numeric_overflow');

COMMIT;