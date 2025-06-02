-- Rollback Migration: Remove Category System
-- Version: 001

BEGIN;

-- Drop indexes
DROP INDEX IF EXISTS idx_tokens_category;
DROP INDEX IF EXISTS idx_tokens_category_updated;
DROP INDEX IF EXISTS idx_tokens_market_cap_category;
DROP INDEX IF EXISTS idx_tokens_aim_candidates;
DROP INDEX IF EXISTS idx_transitions_token;
DROP INDEX IF EXISTS idx_transitions_created;
DROP INDEX IF EXISTS idx_evaluations_token;
DROP INDEX IF EXISTS idx_evaluations_passed;

-- Drop tables
DROP TABLE IF EXISTS buy_evaluations;
DROP TABLE IF EXISTS category_transitions;

-- Remove constraint
ALTER TABLE tokens DROP CONSTRAINT IF EXISTS check_category;

-- Remove columns from tokens
ALTER TABLE tokens 
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS category_updated_at,
DROP COLUMN IF EXISTS previous_category,
DROP COLUMN IF EXISTS category_scan_count,
DROP COLUMN IF EXISTS aim_attempts,
DROP COLUMN IF EXISTS buy_attempts,
DROP COLUMN IF EXISTS buy_failure_reasons,
DROP COLUMN IF EXISTS top_10_percent,
DROP COLUMN IF EXISTS solsniffer_score,
DROP COLUMN IF EXISTS solsniffer_checked_at;

-- Remove columns from scan_logs
ALTER TABLE scan_logs
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS scan_number,
DROP COLUMN IF EXISTS is_final_scan;

-- Remove from migrations
DELETE FROM schema_migrations WHERE version = '001_add_category_system';

COMMIT;
