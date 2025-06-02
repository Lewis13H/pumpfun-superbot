-- Migration: Add Category System
-- Version: 001
-- Date: 2025-06-01

BEGIN;

-- Add category fields to tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'NEW',
ADD COLUMN IF NOT EXISTS category_updated_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS previous_category VARCHAR(20),
ADD COLUMN IF NOT EXISTS category_scan_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS aim_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS buy_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS buy_failure_reasons JSONB,
ADD COLUMN IF NOT EXISTS top_10_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS solsniffer_score INTEGER,
ADD COLUMN IF NOT EXISTS solsniffer_checked_at TIMESTAMP;

-- Create category constraint
ALTER TABLE tokens 
ADD CONSTRAINT check_category 
CHECK (category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'));

-- Create category transitions table
CREATE TABLE IF NOT EXISTS category_transitions (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
  from_category VARCHAR(20),
  to_category VARCHAR(20) NOT NULL,
  market_cap_at_transition DECIMAL(20,2),
  reason VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create buy evaluations table
CREATE TABLE IF NOT EXISTS buy_evaluations (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
  market_cap DECIMAL(20,2) NOT NULL,
  liquidity DECIMAL(20,2) NOT NULL,
  holders INTEGER,
  top_10_percent DECIMAL(5,2),
  solsniffer_score INTEGER,
  
  -- Individual criteria results
  market_cap_pass BOOLEAN NOT NULL,
  liquidity_pass BOOLEAN NOT NULL,
  holders_pass BOOLEAN,
  concentration_pass BOOLEAN,
  solsniffer_pass BOOLEAN,
  
  -- Overall result
  passed BOOLEAN NOT NULL,
  failure_reasons JSONB,
  position_size DECIMAL(10,4),
  
  -- Metadata
  evaluation_duration_ms INTEGER,
  api_costs JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Update scan_logs table
ALTER TABLE scan_logs
ADD COLUMN IF NOT EXISTS category VARCHAR(20),
ADD COLUMN IF NOT EXISTS scan_number INTEGER,
ADD COLUMN IF NOT EXISTS is_final_scan BOOLEAN DEFAULT FALSE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tokens_category ON tokens(category);
CREATE INDEX IF NOT EXISTS idx_tokens_category_updated ON tokens(category_updated_at);
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap_category ON tokens(market_cap, category);
CREATE INDEX IF NOT EXISTS idx_tokens_aim_candidates ON tokens(category, market_cap) 
  WHERE category IN ('HIGH', 'AIM');
CREATE INDEX IF NOT EXISTS idx_transitions_token ON category_transitions(token_address);
CREATE INDEX IF NOT EXISTS idx_transitions_created ON category_transitions(created_at);
CREATE INDEX IF NOT EXISTS idx_evaluations_token ON buy_evaluations(token_address);
CREATE INDEX IF NOT EXISTS idx_evaluations_passed ON buy_evaluations(passed);

-- Create migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(20) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_add_category_system');

COMMIT;
