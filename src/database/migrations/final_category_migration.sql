-- Complete category system setup

BEGIN;

-- Create scan_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS scan_logs (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44),
  timestamp TIMESTAMP DEFAULT NOW(),
  scan_duration_ms INTEGER,
  apis_called JSONB,
  api_costs JSONB,
  errors JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add category columns to scan_logs
ALTER TABLE scan_logs
ADD COLUMN IF NOT EXISTS category VARCHAR(20),
ADD COLUMN IF NOT EXISTS scan_number INTEGER,
ADD COLUMN IF NOT EXISTS is_final_scan BOOLEAN DEFAULT FALSE;

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

-- Create all indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tokens_category_updated ON tokens(category_updated_at);
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap_category ON tokens(market_cap, category);
CREATE INDEX IF NOT EXISTS idx_tokens_aim_candidates ON tokens(category, market_cap) 
  WHERE category IN ('HIGH', 'AIM');
CREATE INDEX IF NOT EXISTS idx_transitions_token ON category_transitions(token_address);
CREATE INDEX IF NOT EXISTS idx_transitions_created ON category_transitions(created_at);
CREATE INDEX IF NOT EXISTS idx_evaluations_token ON buy_evaluations(token_address);
CREATE INDEX IF NOT EXISTS idx_evaluations_passed ON buy_evaluations(passed);

-- Create migration tracking table if needed
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(20) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- Record migration
INSERT INTO schema_migrations (version) VALUES ('001_add_category_system')
ON CONFLICT (version) DO UPDATE SET applied_at = NOW();

COMMIT;
