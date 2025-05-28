-- Module 2B1: Fixed Database Schema
-- Execute this file to create the required tables

-- First, add new columns to existing tokens table if they don't exist
DO $$
BEGIN
    -- Add volume_24h column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tokens' AND column_name = 'volume_24h') THEN
        ALTER TABLE tokens ADD COLUMN volume_24h DECIMAL(20,2);
    END IF;
    
    -- Add liquidity column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tokens' AND column_name = 'liquidity') THEN
        ALTER TABLE tokens ADD COLUMN liquidity DECIMAL(20,2);
    END IF;
    
    -- Add price column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tokens' AND column_name = 'price') THEN
        ALTER TABLE tokens ADD COLUMN price DECIMAL(30,18);
    END IF;
    
    -- Add price_change_24h column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tokens' AND column_name = 'price_change_24h') THEN
        ALTER TABLE tokens ADD COLUMN price_change_24h DECIMAL(10,6);
    END IF;
END $$;

-- Create market metrics history table
CREATE TABLE IF NOT EXISTS market_metrics_history (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Price metrics
    price DECIMAL(30,18),
    price_change_1m DECIMAL(10,6),
    price_change_5m DECIMAL(10,6),
    price_change_15m DECIMAL(10,6),
    price_change_1h DECIMAL(10,6),
    price_change_24h DECIMAL(10,6),
    
    -- Volume metrics
    volume_1m DECIMAL(20,2),
    volume_5m DECIMAL(20,2),
    volume_15m DECIMAL(20,2),
    volume_1h DECIMAL(20,2),
    volume_24h DECIMAL(20,2),
    volume_change_1h DECIMAL(10,6),
    
    -- Liquidity metrics
    liquidity_usd DECIMAL(20,2),
    liquidity_change_1h DECIMAL(10,6),
    buy_pressure DECIMAL(8,4),
    sell_pressure DECIMAL(8,4),
    
    -- Trading metrics
    trades_1m INTEGER DEFAULT 0,
    trades_5m INTEGER DEFAULT 0,
    trades_15m INTEGER DEFAULT 0,
    trades_1h INTEGER DEFAULT 0,
    unique_traders_1h INTEGER DEFAULT 0,
    avg_trade_size DECIMAL(20,2),
    
    -- Market health indicators
    market_cap DECIMAL(20,2),
    market_cap_change_1h DECIMAL(10,6),
    volatility_1h DECIMAL(8,4),
    slippage_1_percent DECIMAL(8,4),
    slippage_5_percent DECIMAL(8,4),
    
    -- Manipulation indicators
    manipulation_score DECIMAL(5,4) DEFAULT 0,
    wash_trading_score DECIMAL(5,4) DEFAULT 0,
    pump_dump_score DECIMAL(5,4) DEFAULT 0,
    
    -- Pattern recognition
    trend_direction VARCHAR(10),
    trend_strength DECIMAL(5,4),
    support_level DECIMAL(30,18),
    resistance_level DECIMAL(30,18)
);

-- Create price alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    alert_type VARCHAR(20) NOT NULL,
    threshold_value DECIMAL(20,2),
    current_value DECIMAL(20,2),
    percentage_change DECIMAL(10,6),
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    severity VARCHAR(10) NOT NULL,
    message TEXT,
    is_processed BOOLEAN DEFAULT FALSE
);

-- Create trading patterns table
CREATE TABLE IF NOT EXISTS trading_patterns (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    pattern_type VARCHAR(30) NOT NULL,
    confidence_score DECIMAL(5,4),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    pattern_data JSONB,
    predicted_direction VARCHAR(10),
    predicted_timeframe VARCHAR(20),
    predicted_magnitude DECIMAL(10,6),
    actual_outcome VARCHAR(10),
    validation_timestamp TIMESTAMP WITH TIME ZONE,
    pattern_success BOOLEAN
);

-- Create analysis performance table
CREATE TABLE IF NOT EXISTS analysis_performance (
    id SERIAL PRIMARY KEY,
    analysis_type VARCHAR(30) NOT NULL,
    tokens_processed INTEGER DEFAULT 0,
    avg_processing_time_ms INTEGER DEFAULT 0,
    success_rate DECIMAL(5,4) DEFAULT 0,
    api_calls_made INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,4) DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_market_metrics_token_time ON market_metrics_history(token_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_timestamp ON market_metrics_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_volume ON market_metrics_history(volume_24h DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_manipulation ON market_metrics_history(manipulation_score DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_trend ON market_metrics_history(trend_direction, trend_strength DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_token ON price_alerts(token_address, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_unprocessed ON price_alerts(is_processed, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_severity ON price_alerts(severity, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_type ON price_alerts(alert_type, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_patterns_token ON trading_patterns(token_address, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_type ON trading_patterns(pattern_type, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_success ON trading_patterns(pattern_success, confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_performance_time ON analysis_performance(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_performance_type ON analysis_performance(analysis_type, timestamp DESC);

-- Create market analysis view
CREATE OR REPLACE VIEW market_analysis_current AS
SELECT 
    t.address,
    t.symbol,
    t.name,
    t.platform,
    COALESCE(t.composite_score, 0) as composite_score,
    COALESCE(t.safety_score, 0) as safety_score,
    COALESCE(t.potential_score, 0) as potential_score,
    COALESCE(t.investment_classification, 'STANDARD') as investment_classification,
    
    -- Latest market metrics
    mm.price,
    mm.price_change_1h,
    mm.price_change_24h,
    mm.volume_1h,
    mm.volume_24h,
    mm.volume_change_1h,
    mm.liquidity_usd,
    mm.liquidity_change_1h,
    mm.market_cap,
    mm.market_cap_change_1h,
    mm.volatility_1h,
    COALESCE(mm.manipulation_score, 0) as manipulation_score,
    COALESCE(mm.wash_trading_score, 0) as wash_trading_score,
    COALESCE(mm.pump_dump_score, 0) as pump_dump_score,
    COALESCE(mm.trend_direction, 'SIDEWAYS') as trend_direction,
    COALESCE(mm.trend_strength, 0) as trend_strength,
    mm.support_level,
    mm.resistance_level,
    
    -- Risk indicators
    CASE 
        WHEN COALESCE(mm.manipulation_score, 0) > 0.7 THEN 'HIGH_RISK'
        WHEN COALESCE(mm.manipulation_score, 0) > 0.4 THEN 'MEDIUM_RISK'
        ELSE 'LOW_RISK'
    END as risk_level,
    
    -- Market health score calculation
    COALESCE(
        (
            CASE WHEN COALESCE(mm.liquidity_usd, 0) > 100000 THEN 0.3 
                 WHEN COALESCE(mm.liquidity_usd, 0) > 0 THEN (mm.liquidity_usd / 100000) * 0.3 
                 ELSE 0 END +
            CASE WHEN COALESCE(mm.volume_24h, 0) > 50000 THEN 0.3 
                 WHEN COALESCE(mm.volume_24h, 0) > 0 THEN (mm.volume_24h / 50000) * 0.3 
                 ELSE 0 END +
            CASE WHEN COALESCE(mm.volatility_1h, 1) < 0.2 THEN 0.2 
                 ELSE (1 - COALESCE(mm.volatility_1h, 0.5)) * 0.2 END +
            (1 - COALESCE(mm.manipulation_score, 0)) * 0.2
        ), 0.1
    ) as market_health_score,
    
    -- Age in hours
    EXTRACT(EPOCH FROM (NOW() - COALESCE(t.created_at, t.discovered_at))) / 3600 as age_hours,
    
    COALESCE(mm.timestamp, t.updated_at) as last_updated,
    t.discovered_at,
    t.created_at
FROM tokens t
LEFT JOIN LATERAL (
    SELECT * FROM market_metrics_history 
    WHERE token_address = t.address 
    ORDER BY timestamp DESC 
    LIMIT 1
) mm ON true
WHERE COALESCE(t.analysis_status, 'PENDING') = 'COMPLETED';

-- Create system stats view
CREATE OR REPLACE VIEW system_stats AS
SELECT 
    'tokens' as table_name,
    COUNT(*)::text as total_records,
    COUNT(CASE WHEN COALESCE(analysis_status, 'PENDING') = 'COMPLETED' THEN 1 END)::text as analyzed_tokens,
    COALESCE(MAX(discovered_at)::text, 'None') as latest_discovery
FROM tokens
UNION ALL
SELECT 
    'market_metrics_history' as table_name,
    COUNT(*)::text as total_records,
    COUNT(DISTINCT token_address)::text as unique_tokens,
    COALESCE(MAX(timestamp)::text, 'None') as latest_metric
FROM market_metrics_history
UNION ALL
SELECT 
    'price_alerts' as table_name,
    COUNT(*)::text as total_records,
    COUNT(CASE WHEN is_processed = false THEN 1 END)::text as unprocessed_alerts,
    COALESCE(MAX(triggered_at)::text, 'None') as latest_alert
FROM price_alerts
UNION ALL
SELECT 
    'trading_patterns' as table_name,
    COUNT(*)::text as total_records,
    COUNT(CASE WHEN pattern_success = true THEN 1 END)::text as successful_patterns,
    COALESCE(MAX(detected_at)::text, 'None') as latest_pattern
FROM trading_patterns;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solana_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solana_user;

-- Final verification
DO $$
DECLARE
    table_count INTEGER;
    view_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('market_metrics_history', 'price_alerts', 'trading_patterns', 'analysis_performance');
    
    SELECT COUNT(*) INTO view_count
    FROM information_schema.views 
    WHERE table_schema = 'public' 
    AND table_name IN ('market_analysis_current', 'system_stats');
    
    RAISE NOTICE 'Module 2B1 Database Schema Applied Successfully!';
    RAISE NOTICE 'Tables created: %', table_count;
    RAISE NOTICE 'Views created: %', view_count;
    
    IF table_count = 4 AND view_count = 2 THEN
        RAISE NOTICE '✅ All database objects created successfully';
    ELSE
        RAISE WARNING '⚠️  Expected 4 tables and 2 views, got % tables and % views', table_count, view_count;
    END IF;
END $$;
EOF

# Apply the schema
echo "Applying database schema..."
psql -h localhost -U solana_user -d solana_tokens -f scripts/module-2b1-schema-fixed.sql

echo "✅ Database schema applied!"