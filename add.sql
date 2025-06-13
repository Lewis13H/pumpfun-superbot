-- Fixed Database Migration for Shyft RPC Integration
-- Replace 'your_app_user' with your actual database user

-- 1. First, ensure all required columns exist in tokens table
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS decimals INTEGER DEFAULT 6;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS total_supply NUMERIC;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_uri TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_source VARCHAR(50);
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS holder_distribution JSONB;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS holder_update_time TIMESTAMP;

-- Add missing columns that might be referenced
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS unique_buyers_24h INTEGER DEFAULT 0;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS unique_sellers_24h INTEGER DEFAULT 0;

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_tokens_metadata_source ON tokens(metadata_source);
CREATE INDEX IF NOT EXISTS idx_tokens_category_market_cap 
ON tokens(category, market_cap DESC) 
WHERE category IN ('LOW', 'MEDIUM', 'HIGH', 'AIM', 'GRADUATED');

-- 3. Create token metadata table
CREATE TABLE IF NOT EXISTS token_metadata (
    token_address VARCHAR(44) PRIMARY KEY REFERENCES tokens(address),
    name VARCHAR(255),
    symbol VARCHAR(50),
    description TEXT,
    decimals INTEGER,
    total_supply NUMERIC,
    image_uri TEXT,
    external_url TEXT,
    attributes JSONB,
    on_chain_metadata JSONB,
    shyft_metadata JSONB,
    helius_metadata JSONB,
    metadata_uri TEXT,
    update_authority VARCHAR(44),
    is_mutable BOOLEAN,
    primary_sale_happened BOOLEAN,
    seller_fee_basis_points INTEGER,
    creators JSONB,
    fetched_at TIMESTAMP DEFAULT NOW(),
    last_updated TIMESTAMP DEFAULT NOW()
);

-- 4. Create holder snapshots table
CREATE TABLE IF NOT EXISTS token_holder_snapshots (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) REFERENCES tokens(address),
    snapshot_time TIMESTAMP DEFAULT NOW(),
    total_holders INTEGER,
    top_1_percent NUMERIC,
    top_5_percent NUMERIC,
    top_10_percent NUMERIC,
    top_25_percent NUMERIC,
    top_50_percent NUMERIC,
    holder_list JSONB,
    concentration_score NUMERIC,
    distribution_score NUMERIC
);

-- 5. Create index for holder snapshots
CREATE INDEX IF NOT EXISTS idx_holder_snapshots_token_time 
ON token_holder_snapshots(token_address, snapshot_time DESC);

-- 6. Enhanced transaction details table
CREATE TABLE IF NOT EXISTS transaction_details (
    signature VARCHAR(88) PRIMARY KEY,
    token_address VARCHAR(44) REFERENCES tokens(address),
    parsed_at TIMESTAMP DEFAULT NOW(),
    instruction_type VARCHAR(50),
    program_id VARCHAR(44),
    accounts JSONB,
    instruction_data JSONB,
    inner_instructions JSONB,
    token_transfers JSONB,
    pre_balances JSONB,
    post_balances JSONB,
    logs TEXT[],
    compute_units_consumed INTEGER,
    priority_fee BIGINT
);

-- 7. Create index for transaction details
CREATE INDEX IF NOT EXISTS idx_transaction_details_token_type 
ON transaction_details(token_address, instruction_type, parsed_at DESC);

-- 8. Grant permissions (replace 'your_actual_db_user' with your database user)
-- To find your current user, run: SELECT current_user;
-- Example for common users:
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO postgres;