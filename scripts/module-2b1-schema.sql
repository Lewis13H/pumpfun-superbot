-- Module 2B1: Core Market Metrics & Real-time Monitoring
-- Database Schema Updates
-- Execute this file after backing up your existing database

-- Add new columns to existing tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS liquidity DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS price DECIMAL(30,18),
ADD COLUMN IF NOT EXISTS price_change_24h DECIMAL(10,6);

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
    trend_direction VARCHAR(10), -- 'UP', 'DOWN', 'SIDEWAYS'
    trend_strength DECIMAL(5,4),
    support_level DECIMAL(30,18),
    resistance_level DECIMAL(30,18),
    
    -- Foreign key constraint
    CONSTRAINT fk_market_metrics_token FOREIGN KEY (token_address) REFERENCES tokens(address) ON DELETE CASCADE
);

-- Create indexes for market_metrics_history
CREATE INDEX IF NOT EXISTS idx_market_metrics_token_time ON market_metrics_history(token_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_timestamp ON market_metrics_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_volume ON market_metrics_history(volume_24h DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_manipulation ON market_metrics_history(manipulation_score DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_trend ON market_metrics_history(trend_direction, trend_strength DESC);

-- Create price alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    alert_type VARCHAR(20) NOT NULL, -- 'PRICE_SPIKE', 'VOLUME_SPIKE', 'LIQUIDITY_DROP', etc.
    threshold_value DECIMAL(20,2),
    current_value DECIMAL(20,2),
    percentage_change DECIMAL(10,6),
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    severity VARCHAR(10) NOT NULL, -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    message TEXT,
    is_processed BOOLEAN DEFAULT FALSE,
    
    -- Foreign key constraint
    CONSTRAINT fk_price_alerts_token FOREIGN KEY (token_address) REFERENCES tokens(address) ON DELETE CASCADE
);

-- Create indexes for price_alerts
CREATE INDEX IF NOT EXISTS idx_price_alerts_token ON price_alerts(token_address, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_unprocessed ON price_alerts(is_processed, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_severity ON price_alerts(severity, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_type ON price_alerts(alert_type, triggered_at DESC);

-- Create trading patterns table
CREATE TABLE IF NOT EXISTS trading_patterns (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(44) NOT NULL,
    pattern_type VARCHAR(30) NOT NULL, -- 'BREAKOUT', 'REVERSAL', 'ACCUMULATION', etc.
    confidence_score DECIMAL(5,4),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Pattern specific data
    pattern_data JSONB,
    
    -- Prediction data
    predicted_direction VARCHAR(10), -- 'UP', 'DOWN', 'SIDEWAYS'
    predicted_timeframe VARCHAR(20), -- '1h', '4h', '24h', etc.
    predicted_magnitude DECIMAL(10,6),
    
    -- Validation data
    actual_outcome VARCHAR(10),
    validation_timestamp TIMESTAMP WITH TIME ZONE,
    pattern_success BOOLEAN,
    
    -- Foreign key constraint
    CONSTRAINT fk_trading_patterns_token FOREIGN KEY (token_address) REFERENCES tokens(address) ON DELETE CASCADE
);

-- Create indexes for trading_patterns
CREATE INDEX IF NOT EXISTS idx_trading_patterns_token ON trading_patterns(token_address, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_type ON trading_patterns(pattern_type, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_success ON trading_patterns(pattern_success, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_timeframe ON trading_patterns(predicted_timeframe, detected_at DESC);

-- Create analysis performance tracking table
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

-- Create index for analysis_performance
CREATE INDEX IF NOT EXISTS idx_analysis_performance_time ON analysis_performance(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_performance_type ON analysis_performance(analysis_type, timestamp DESC);

-- Create market analysis current view
CREATE OR REPLACE VIEW market_analysis_current AS
SELECT 
    t.address,
    t.symbol,
    t.name,
    t.platform,
    t.composite_score,
    t.safety_score,
    t.potential_score,
    t.investment_classification,
    
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
    mm.manipulation_score,
    mm.wash_trading_score,
    mm.pump_dump_score,
    mm.trend_direction,
    mm.trend_strength,
    mm.support_level,
    mm.resistance_level,
    
    -- Risk indicators
    CASE 
        WHEN mm.manipulation_score > 0.7 THEN 'HIGH_RISK'
        WHEN mm.manipulation_score > 0.4 THEN 'MEDIUM_RISK'
        WHEN mm.manipulation_score IS NULL THEN 'UNKNOWN_RISK'
        ELSE 'LOW_RISK'
    END as risk_level,
    
    -- Market health score calculation
    COALESCE(
        (
            CASE WHEN mm.liquidity_usd > 100000 THEN 0.3 
                 WHEN mm.liquidity_usd > 0 THEN (mm.liquidity_usd / 100000) * 0.3 
                 ELSE 0 END +
            CASE WHEN mm.volume_24h > 50000 THEN 0.3 
                 WHEN mm.volume_24h > 0 THEN (mm.volume_24h / 50000) * 0.3 
                 ELSE 0 END +
            CASE WHEN mm.volatility_1h < 0.2 THEN 0.2 
                 WHEN mm.volatility_1h IS NOT NULL THEN (1 - mm.volatility_1h) * 0.2 
                 ELSE 0.1 END +
            CASE WHEN mm.manipulation_score IS NOT NULL THEN (1 - mm.manipulation_score) * 0.2 
                 ELSE 0.1 END
        ), 0.1
    ) as market_health_score,
    
    -- Age in hours
    EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 as age_hours,
    
    mm.timestamp as last_updated,
    t.discovered_at,
    t.created_at
FROM tokens t
LEFT JOIN LATERAL (
    SELECT * FROM market_metrics_history 
    WHERE token_address = t.address 
    ORDER BY timestamp DESC 
    LIMIT 1
) mm ON true
WHERE t.analysis_status = 'COMPLETED';

-- Create indexes on the base tables to optimize the view
CREATE INDEX IF NOT EXISTS idx_tokens_analysis_status ON tokens(analysis_status) WHERE analysis_status = 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_tokens_composite_score ON tokens(composite_score DESC) WHERE composite_score > 0;
CREATE INDEX IF NOT EXISTS idx_tokens_classification ON tokens(investment_classification);

-- Create a materialized view for better performance on complex queries
CREATE MATERIALIZED VIEW IF NOT EXISTS market_summary_hourly AS
SELECT 
    DATE_TRUNC('hour', mm.timestamp) as hour,
    COUNT(DISTINCT mm.token_address) as tokens_analyzed,
    AVG(mm.price) as avg_price,
    SUM(mm.volume_24h) as total_volume_24h,
    AVG(mm.liquidity_usd) as avg_liquidity,
    AVG(mm.manipulation_score) as avg_manipulation_score,
    COUNT(CASE WHEN mm.trend_direction = 'UP' THEN 1 END) as tokens_trending_up,
    COUNT(CASE WHEN mm.trend_direction = 'DOWN' THEN 1 END) as tokens_trending_down,
    COUNT(CASE WHEN mm.manipulation_score > 0.7 THEN 1 END) as high_risk_tokens
FROM market_metrics_history mm
WHERE mm.timestamp >= NOW() - INTERVAL '7 DAYS'
GROUP BY DATE_TRUNC('hour', mm.timestamp)
ORDER BY hour DESC;

-- Create index for materialized view
CREATE INDEX IF NOT EXISTS idx_market_summary_hourly_hour ON market_summary_hourly(hour DESC);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_market_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW market_summary_hourly;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically refresh the materialized view
-- (This will be called periodically by the application)

-- Add useful functions for market analysis
CREATE OR REPLACE FUNCTION get_token_market_health(token_addr VARCHAR(44))
RETURNS DECIMAL(5,4) AS $$
DECLARE
    health_score DECIMAL(5,4) := 0;
    latest_metrics RECORD;
BEGIN
    SELECT * INTO latest_metrics
    FROM market_metrics_history 
    WHERE token_address = token_addr 
    ORDER BY timestamp DESC 
    LIMIT 1;
    
    IF latest_metrics IS NOT NULL THEN
        -- Liquidity component (30%)
        IF latest_metrics.liquidity_usd > 100000 THEN
            health_score := health_score + 0.3;
        ELSIF latest_metrics.liquidity_usd > 0 THEN
            health_score := health_score + (latest_metrics.liquidity_usd / 100000) * 0.3;
        END IF;
        
        -- Volume component (30%)
        IF latest_metrics.volume_24h > 50000 THEN
            health_score := health_score + 0.3;
        ELSIF latest_metrics.volume_24h > 0 THEN
            health_score := health_score + (latest_metrics.volume_24h / 50000) * 0.3;
        END IF;
        
        -- Volatility component (20%)
        IF latest_metrics.volatility_1h IS NOT NULL THEN
            IF latest_metrics.volatility_1h < 0.2 THEN
                health_score := health_score + 0.2;
            ELSE
                health_score := health_score + (1 - latest_metrics.volatility_1h) * 0.2;
            END IF;
        ELSE
            health_score := health_score + 0.1;
        END IF;
        
        -- Manipulation component (20%)
        IF latest_metrics.manipulation_score IS NOT NULL THEN
            health_score := health_score + (1 - latest_metrics.manipulation_score) * 0.2;
        ELSE
            health_score := health_score + 0.1;
        END IF;
    ELSE
        health_score := 0.1; -- Default for tokens without metrics
    END IF;
    
    RETURN LEAST(1.0, health_score);
END;
$$ LANGUAGE plpgsql;

-- Add constraints to ensure data quality
ALTER TABLE market_metrics_history 
ADD CONSTRAINT chk_price_positive CHECK (price IS NULL OR price >= 0),
ADD CONSTRAINT chk_volume_positive CHECK (volume_24h IS NULL OR volume_24h >= 0),
ADD CONSTRAINT chk_liquidity_positive CHECK (liquidity_usd IS NULL OR liquidity_usd >= 0),
ADD CONSTRAINT chk_manipulation_score_range CHECK (manipulation_score IS NULL OR (manipulation_score >= 0 AND manipulation_score <= 1)),
ADD CONSTRAINT chk_trend_direction_valid CHECK (trend_direction IS NULL OR trend_direction IN ('UP', 'DOWN', 'SIDEWAYS'));

ALTER TABLE price_alerts
ADD CONSTRAINT chk_severity_valid CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
ADD CONSTRAINT chk_alert_type_valid CHECK (alert_type IN ('PRICE_SPIKE', 'VOLUME_SPIKE', 'LIQUIDITY_DROP', 'MANIPULATION_RISK', 'PATTERN_DETECTED'));

ALTER TABLE trading_patterns
ADD CONSTRAINT chk_confidence_score_range CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
ADD CONSTRAINT chk_predicted_direction_valid CHECK (predicted_direction IS NULL OR predicted_direction IN ('UP', 'DOWN', 'SIDEWAYS'));

-- Create performance optimization stored procedures
CREATE OR REPLACE FUNCTION cleanup_old_metrics()
RETURNS void AS $$
BEGIN
    -- Remove metrics older than 30 days
    DELETE FROM market_metrics_history 
    WHERE timestamp < NOW() - INTERVAL '30 DAYS';
    
    -- Remove processed alerts older than 7 days
    DELETE FROM price_alerts 
    WHERE is_processed = true AND triggered_at < NOW() - INTERVAL '7 DAYS';
    
    -- Remove old trading patterns that weren't successful
    DELETE FROM trading_patterns 
    WHERE detected_at < NOW() - INTERVAL '14 DAYS' 
    AND (pattern_success = false OR pattern_success IS NULL);
    
    -- Remove old performance records
    DELETE FROM analysis_performance 
    WHERE timestamp < NOW() - INTERVAL '30 DAYS';
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solana_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solana_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO solana_user;

-- Create summary statistics
CREATE OR REPLACE VIEW system_stats AS
SELECT 
    'tokens' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN analysis_status = 'COMPLETED' THEN 1 END) as analyzed_tokens,
    MAX(discovered_at) as latest_discovery
FROM tokens
UNION ALL
SELECT 
    'market_metrics_history' as table_name,
    COUNT(*) as total_records,
    COUNT(DISTINCT token_address) as unique_tokens,
    MAX(timestamp) as latest_metric
FROM market_metrics_history
UNION ALL
SELECT 
    'price_alerts' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN is_processed = false THEN 1 END) as unprocessed_alerts,
    MAX(triggered_at) as latest_alert
FROM price_alerts
UNION ALL
SELECT 
    'trading_patterns' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN pattern_success = true THEN 1 END) as successful_patterns,
    MAX(detected_at) as latest_pattern
FROM trading_patterns;

-- Final verification
DO $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
    view_count INTEGER;
BEGIN
    -- Count tables
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('market_metrics_history', 'price_alerts', 'trading_patterns', 'analysis_performance');
    
    -- Count indexes
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes 
    WHERE tablename IN ('market_metrics_history', 'price_alerts', 'trading_patterns');
    
    -- Count views
    SELECT COUNT(*) INTO view_count
    FROM information_schema.views 
    WHERE table_schema = 'public' 
    AND table_name IN ('market_analysis_current', 'system_stats');
    
    RAISE NOTICE 'Module 2B1 Database Schema Applied Successfully!';
    RAISE NOTICE 'Tables created: %', table_count;
    RAISE NOTICE 'Indexes created: %', index_count;
    RAISE NOTICE 'Views created: %', view_count;
    
    IF table_count = 4 AND view_count = 2 THEN
        RAISE NOTICE '✅ All database objects created successfully';
    ELSE
        RAISE WARNING '⚠️  Some database objects may not have been created correctly';
    END IF;
END $$;