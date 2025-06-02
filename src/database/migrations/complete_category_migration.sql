-- Complete category system migration

BEGIN;

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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tokens_category_updated ON tokens(category_updated_at);
CREATE INDEX IF NOT EXISTS idx_tokens_market_cap_category ON tokens(market_cap, category);
CREATE INDEX IF NOT EXISTS idx_tokens_aim_candidates ON tokens(category, market_cap) 
  WHERE category IN ('HIGH', 'AIM');
CREATE INDEX IF NOT EXISTS idx_transitions_token ON category_transitions(token_address);
CREATE INDEX IF NOT EXISTS idx_transitions_created ON category_transitions(created_at);
CREATE INDEX IF NOT EXISTS idx_evaluations_token ON buy_evaluations(token_address);
CREATE INDEX IF NOT EXISTS idx_evaluations_passed ON buy_evaluations(passed);

-- Record migration (now with proper column size)
INSERT INTO schema_migrations (version) VALUES ('001_add_category_system')
ON CONFLICT (version) DO UPDATE SET applied_at = NOW();

COMMIT;
