ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS price_change_1h DECIMAL(10,4);
ALTER TABLE market_metrics_history ADD COLUMN IF NOT EXISTS volume_1h DECIMAL(20,2);

ALTER TABLE trading_patterns ADD COLUMN IF NOT EXISTS pattern_data JSONB;
ALTER TABLE trading_patterns ADD COLUMN IF NOT EXISTS pattern_type VARCHAR(50);
ALTER TABLE trading_patterns ADD COLUMN IF NOT EXISTS predicted_direction VARCHAR(20);
ALTER TABLE trading_patterns ADD COLUMN IF NOT EXISTS predicted_timeframe VARCHAR(20);