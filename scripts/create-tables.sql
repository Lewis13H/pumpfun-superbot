-- Tokens table
CREATE TABLE IF NOT EXISTS tokens (
    address VARCHAR(44) PRIMARY KEY,
    symbol VARCHAR(20),
    name VARCHAR(100),
    platform VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE,
    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Market data
    market_cap DECIMAL(20,2),
    price DECIMAL(30,18),
    volume_24h DECIMAL(20,2),
    liquidity DECIMAL(20,2),
    
    -- Analysis scores
    safety_score DECIMAL(5,4),
    potential_score DECIMAL(5,4),
    composite_score DECIMAL(5,4),
    
    -- Status
    analysis_status VARCHAR(20) DEFAULT 'PENDING',
    investment_classification VARCHAR(20),
    
    -- Metadata
    raw_data JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tokens_created ON tokens(created_at DESC);
CREATE INDEX idx_tokens_score ON tokens(composite_score DESC);
CREATE INDEX idx_tokens_platform_score ON tokens(platform, composite_score DESC);
CREATE INDEX idx_tokens_status ON tokens(analysis_status, discovered_at DESC);

-- Token analysis history
CREATE TABLE IF NOT EXISTS token_analysis_history (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) REFERENCES tokens(address),
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Analysis results
    holders_data JSONB,
    security_data JSONB,
    liquidity_data JSONB,
    trading_data JSONB,
    social_data JSONB,
    
    -- Scores at time of analysis
    safety_score DECIMAL(5,4),
    potential_score DECIMAL(5,4),
    composite_score DECIMAL(5,4),
    
    -- ML predictions
    ml_classification VARCHAR(20),
    ml_confidence DECIMAL(5,4)
);

CREATE INDEX idx_analysis_token_time ON token_analysis_history(token_address, analyzed_at DESC);

-- Holder analysis
CREATE TABLE IF NOT EXISTS token_holders (
    token_address VARCHAR(44),
    holder_address VARCHAR(44),
    amount DECIMAL(30,18),
    percentage DECIMAL(8,5),
    rank INTEGER,
    holder_type VARCHAR(20),
    first_purchase_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (token_address, holder_address)
);

CREATE INDEX idx_holders_token_rank ON token_holders(token_address, rank);
CREATE INDEX idx_holders_type ON token_holders(holder_type, percentage DESC);