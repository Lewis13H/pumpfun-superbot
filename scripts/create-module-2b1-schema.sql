-- Create missing columns for market_metrics_history
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS avg_trade_size DECIMAL(20,8);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS buy_pressure DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS sell_pressure DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS liquidity_change_1h DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price_change_15m DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price_change_1m DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price_change_5m DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS market_cap_change_1h DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_15m DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_1m DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_5m DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_change_1h DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trades_15m INTEGER;
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trades_1m INTEGER;
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trades_5m INTEGER;
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS unique_traders_1h INTEGER;
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS resistance_level DECIMAL(30,18);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS support_level DECIMAL(30,18);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS slippage_1_percent DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS slippage_5_percent DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volatility_1h DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS wash_trading_score DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS pump_dump_score DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trend_direction VARCHAR(20);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trend_strength DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price_change_24h DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS market_cap DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_24h DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS liquidity_usd DECIMAL(20,2);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS manipulation_score DECIMAL(5,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price DECIMAL(30,18);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS trades_1h INTEGER;

-- Create missing columns for trading_patterns
ALTER TABLE trading_patterns ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5,4);

-- Create market_analysis_current view
CREATE OR REPLACE VIEW market_analysis_current AS
SELECT 
    t.address,
    t.symbol,
    t.name,
    t.composite_score,
    t.investment_classification,
    m.price,
    m.price_change_24h,
    m.volume_24h,
    m.liquidity_usd,
    m.market_cap,
    m.manipulation_score,
    m.trend_direction,
    m.timestamp as last_update
FROM tokens t
LEFT JOIN LATERAL (
    SELECT * FROM market_metrics_history 
    WHERE token_address = t.address 
    ORDER BY timestamp DESC 
    LIMIT 1
) m ON true
WHERE t.analysis_status = 'COMPLETED';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_market_metrics_token_time ON market_metrics_history(token_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_token ON price_alerts(token_address);
CREATE INDEX IF NOT EXISTS idx_trading_patterns_token ON trading_patterns(token_address);