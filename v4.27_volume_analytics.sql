-- migrations/v4.27_volume_analytics.sql
-- V4.27: Volume Analytics and Alerting System

-- Create volume_alerts table for storing volume alerts
CREATE TABLE IF NOT EXISTS volume_alerts (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  symbol VARCHAR(20),
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('VOLUME_SPIKE', 'VOLUME_THRESHOLD', 'BUY_SELL_IMBALANCE', 'UNUSUAL_PATTERN')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message TEXT NOT NULL,
  details JSONB,
  metrics JSONB,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  category VARCHAR(20),
  market_cap DECIMAL(30,2),
  CONSTRAINT fk_volume_alerts_token FOREIGN KEY (token_address) REFERENCES tokens(address)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_volume_alerts_token_time ON volume_alerts(token_address, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_volume_alerts_severity_time ON volume_alerts(severity, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_volume_alerts_type_time ON volume_alerts(alert_type, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_volume_alerts_category ON volume_alerts(category);

-- Create volume analytics materialized view for faster queries
CREATE MATERIALIZED VIEW IF NOT EXISTS volume_analytics_summary AS
WITH volume_stats AS (
  SELECT 
    t.address,
    t.symbol,
    t.name,
    t.category,
    t.market_cap,
    
    -- 1 hour volume
    (SELECT 
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0)
     FROM timeseries.token_transactions tt 
     WHERE tt.token_address = t.address 
       AND tt.time > NOW() - INTERVAL '1 hour'
       AND tt.type IN ('buy', 'sell')
    ) as volume_1h_usd,
    
    -- 4 hour volume
    (SELECT 
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0)
     FROM timeseries.token_transactions tt 
     WHERE tt.token_address = t.address 
       AND tt.time > NOW() - INTERVAL '4 hours'
       AND tt.type IN ('buy', 'sell')
    ) as volume_4h_usd,
    
    -- 24 hour volume
    (SELECT 
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0)
     FROM timeseries.token_transactions tt 
     WHERE tt.token_address = t.address 
       AND tt.time > NOW() - INTERVAL '24 hours'
       AND tt.type IN ('buy', 'sell')
    ) as volume_24h_usd,
    
    -- Transaction counts
    (SELECT COUNT(*) 
     FROM timeseries.token_transactions tt 
     WHERE tt.token_address = t.address 
       AND tt.time > NOW() - INTERVAL '1 hour'
       AND tt.type IN ('buy', 'sell')
    ) as tx_count_1h,
    
    -- Buy vs Sell ratio (1h)
    (SELECT 
      CASE 
        WHEN COUNT(*) = 0 THEN 0
        ELSE (COUNT(*) FILTER (WHERE type = 'buy')::float / COUNT(*)::float * 100)
      END
     FROM timeseries.token_transactions tt 
     WHERE tt.token_address = t.address 
       AND tt.time > NOW() - INTERVAL '1 hour'
       AND tt.type IN ('buy', 'sell')
    ) as buy_ratio_1h,
    
    -- Recent alert count
    (SELECT COUNT(*) 
     FROM volume_alerts va 
     WHERE va.token_address = t.address 
       AND va.triggered_at > NOW() - INTERVAL '24 hours'
    ) as alerts_24h,
    
    NOW() as calculated_at
    
  FROM tokens t
  WHERE t.category IN ('MEDIUM', 'HIGH', 'AIM')
    AND t.last_price_update > NOW() - INTERVAL '30 minutes'
)
SELECT * FROM volume_stats
WHERE volume_1h_usd > 100; -- Only include tokens with meaningful volume

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_volume_analytics_summary_address 
ON volume_analytics_summary(address);

CREATE INDEX IF NOT EXISTS idx_volume_analytics_summary_volume_1h 
ON volume_analytics_summary(volume_1h_usd DESC);

CREATE INDEX IF NOT EXISTS idx_volume_analytics_summary_category 
ON volume_analytics_summary(category, volume_1h_usd DESC);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_volume_analytics_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY volume_analytics_summary;
END;
$$ LANGUAGE plpgsql;

-- Function to get volume analytics for a specific token
CREATE OR REPLACE FUNCTION get_token_volume_analytics(token_addr VARCHAR(44))
RETURNS TABLE (
  timeframe TEXT,
  total_volume_usd NUMERIC,
  buy_volume_usd NUMERIC,
  sell_volume_usd NUMERIC,
  transaction_count INTEGER,
  buy_ratio NUMERIC,
  avg_tx_size_usd NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH volume_data AS (
    SELECT 
      '1h' as timeframe,
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0) as total_vol,
      COALESCE(SUM(CASE WHEN tt.type = 'buy' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0) as buy_vol,
      COALESCE(SUM(CASE WHEN tt.type = 'sell' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0) as sell_vol,
      COUNT(*)::integer as tx_count,
      CASE 
        WHEN COUNT(*) = 0 THEN 0::numeric
        ELSE (COUNT(*) FILTER (WHERE type = 'buy')::numeric / COUNT(*)::numeric * 100)
      END as buy_pct
    FROM timeseries.token_transactions tt 
    WHERE tt.token_address = token_addr 
      AND tt.time > NOW() - INTERVAL '1 hour'
      AND tt.type IN ('buy', 'sell')
      
    UNION ALL
    
    SELECT 
      '4h' as timeframe,
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0),
      COALESCE(SUM(CASE WHEN tt.type = 'buy' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tt.type = 'sell' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0),
      COUNT(*)::integer,
      CASE 
        WHEN COUNT(*) = 0 THEN 0::numeric
        ELSE (COUNT(*) FILTER (WHERE type = 'buy')::numeric / COUNT(*)::numeric * 100)
      END
    FROM timeseries.token_transactions tt 
    WHERE tt.token_address = token_addr 
      AND tt.time > NOW() - INTERVAL '4 hours'
      AND tt.type IN ('buy', 'sell')
      
    UNION ALL
    
    SELECT 
      '24h' as timeframe,
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0),
      COALESCE(SUM(CASE WHEN tt.type = 'buy' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tt.type = 'sell' THEN tt.sol_amount::numeric * tt.price_usd ELSE 0 END), 0),
      COUNT(*)::integer,
      CASE 
        WHEN COUNT(*) = 0 THEN 0::numeric
        ELSE (COUNT(*) FILTER (WHERE type = 'buy')::numeric / COUNT(*)::numeric * 100)
      END
    FROM timeseries.token_transactions tt 
    WHERE tt.token_address = token_addr 
      AND tt.time > NOW() - INTERVAL '24 hours'
      AND tt.type IN ('buy', 'sell')
  )
  SELECT 
    vd.timeframe,
    vd.total_vol,
    vd.buy_vol,
    vd.sell_vol,
    vd.tx_count,
    vd.buy_pct,
    CASE WHEN vd.tx_count > 0 THEN vd.total_vol / vd.tx_count ELSE 0 END
  FROM volume_data vd
  ORDER BY 
    CASE vd.timeframe 
      WHEN '1h' THEN 1 
      WHEN '4h' THEN 2 
      WHEN '24h' THEN 3 
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to get top volume performers
CREATE OR REPLACE FUNCTION get_top_volume_performers(
  timeframe_param TEXT DEFAULT '1h',
  limit_param INTEGER DEFAULT 20
)
RETURNS TABLE (
  token_address VARCHAR(44),
  symbol VARCHAR(20),
  name VARCHAR(100),
  category VARCHAR(20),
  market_cap DECIMAL(30,2),
  volume_usd NUMERIC,
  transaction_count INTEGER,
  buy_ratio NUMERIC,
  volume_rank INTEGER
) AS $$
DECLARE
  time_interval INTERVAL;
BEGIN
  -- Set interval based on timeframe
  CASE timeframe_param
    WHEN '1h' THEN time_interval := INTERVAL '1 hour';
    WHEN '4h' THEN time_interval := INTERVAL '4 hours';
    WHEN '24h' THEN time_interval := INTERVAL '24 hours';
    ELSE time_interval := INTERVAL '1 hour';
  END CASE;
  
  RETURN QUERY
  WITH volume_rankings AS (
    SELECT 
      t.address,
      t.symbol,
      t.name,
      t.category,
      t.market_cap,
      COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0) as vol_usd,
      COUNT(*)::integer as tx_count,
      CASE 
        WHEN COUNT(*) = 0 THEN 0::numeric
        ELSE (COUNT(*) FILTER (WHERE tt.type = 'buy')::numeric / COUNT(*)::numeric * 100)
      END as buy_pct,
      ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0) DESC) as rank
    FROM tokens t
    LEFT JOIN timeseries.token_transactions tt ON tt.token_address = t.address
      AND tt.time > NOW() - time_interval
      AND tt.type IN ('buy', 'sell')
    WHERE t.category IN ('MEDIUM', 'HIGH', 'AIM')
      AND t.last_price_update > NOW() - INTERVAL '30 minutes'
    GROUP BY t.address, t.symbol, t.name, t.category, t.market_cap
    HAVING COALESCE(SUM(tt.sol_amount::numeric * tt.price_usd), 0) > 100
  )
  SELECT 
    vr.address,
    vr.symbol,
    vr.name,
    vr.category,
    vr.market_cap,
    vr.vol_usd,
    vr.tx_count,
    vr.buy_pct,
    vr.rank::integer
  FROM volume_rankings vr
  ORDER BY vr.vol_usd DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- Function to get volume alerts summary
CREATE OR REPLACE FUNCTION get_volume_alerts_summary(hours_back INTEGER DEFAULT 24)
RETURNS TABLE (
  alert_type VARCHAR(50),
  severity VARCHAR(20),
  count INTEGER,
  latest_alert TIMESTAMPTZ,
  tokens_affected INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    va.alert_type,
    va.severity,
    COUNT(*)::integer as alert_count,
    MAX(va.triggered_at) as latest,
    COUNT(DISTINCT va.token_address)::integer as unique_tokens
  FROM volume_alerts va
  WHERE va.triggered_at > NOW() - (hours_back * INTERVAL '1 hour')
  GROUP BY va.alert_type, va.severity
  ORDER BY alert_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Create a job to refresh the materialized view every 5 minutes
-- Note: This requires pg_cron extension
SELECT cron.schedule(
  'refresh-volume-analytics',
  '*/5 * * * *', -- Every 5 minutes
  'SELECT refresh_volume_analytics_summary();'
);

-- Insert sample configuration data
INSERT INTO volume_alerts (
  token_address, 
  symbol, 
  alert_type, 
  severity, 
  message, 
  details, 
  metrics,
  category,
  market_cap
) VALUES (
  'EXAMPLE_TOKEN_ADDRESS',
  'EXAMPLE',
  'VOLUME_SPIKE',
  'HIGH',
  'Volume Analytics System Initialized',
  '{"info": "System initialization complete"}',
  '{"info": "Initial setup"}',
  'SYSTEM',
  0
) ON CONFLICT DO NOTHING;

-- Clean up the example record
DELETE FROM volume_alerts WHERE token_address = 'EXAMPLE_TOKEN_ADDRESS';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON volume_alerts TO memecoin_user;
GRANT SELECT ON volume_analytics_summary TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_token_volume_analytics(VARCHAR) TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_top_volume_performers(TEXT, INTEGER) TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_volume_alerts_summary(INTEGER) TO memecoin_user;
GRANT EXECUTE ON FUNCTION refresh_volume_analytics_summary() TO memecoin_user;

-- Add comments for documentation
COMMENT ON TABLE volume_alerts IS 'V4.27: Stores volume-based alerts for MEDIUM, HIGH, and AIM category tokens';
COMMENT ON MATERIALIZED VIEW volume_analytics_summary IS 'V4.27: Cached volume analytics for active tokens in target categories';
COMMENT ON FUNCTION get_token_volume_analytics(VARCHAR) IS 'V4.27: Get comprehensive volume analytics for a specific token';
COMMENT ON FUNCTION get_top_volume_performers(TEXT, INTEGER) IS 'V4.27: Get top volume performers across timeframes';
COMMENT ON FUNCTION get_volume_alerts_summary(INTEGER) IS 'V4.27: Get summary of recent volume alerts';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'V4.27 Volume Analytics System installed successfully!';
  RAISE NOTICE 'Tables created: volume_alerts';
  RAISE NOTICE 'Views created: volume_analytics_summary';
  RAISE NOTICE 'Functions created: get_token_volume_analytics, get_top_volume_performers, get_volume_alerts_summary';
  RAISE NOTICE 'Scheduled job: refresh-volume-analytics (every 5 minutes)';
END $$;