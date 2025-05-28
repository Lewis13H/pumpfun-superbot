-- Simple Module 2B1 Database Fix
-- Save this as: scripts/db-fix.sql

-- Add columns to existing tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS liquidity DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS price DECIMAL(30,18);

-- Create market metrics table
CREATE TABLE IF NOT EXISTS market_metrics_history (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    price DECIMAL(30,18),
    volume_24h DECIMAL(20,2),
    liquidity_usd DECIMAL(20,2),
    manipulation_score DECIMAL(5,4) DEFAULT 0,
    trend_direction VARCHAR(10)
);

-- Create alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    alert_type VARCHAR(20) NOT NULL,
    message TEXT,
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create patterns table
CREATE TABLE IF NOT EXISTS trading_patterns (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    pattern_type VARCHAR(30) NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create performance table
CREATE TABLE IF NOT EXISTS analysis_performance (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(30) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Test the tables were created
SELECT 'SUCCESS: All tables created' as result;