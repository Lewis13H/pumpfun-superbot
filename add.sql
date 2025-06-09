-- Database Schema Updates for Enhanced Liquidity Analytics v4.26

-- 1. Update buy_evaluations table to support new liquidity criteria
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS liquidity_quality_pass BOOLEAN;
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS liquidity_growth_pass BOOLEAN;
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS liquidity_quality_score INTEGER;
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS liquidity_quality_grade VARCHAR(5);
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS liquidity_momentum VARCHAR(20);
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4);
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20);
ALTER TABLE buy_evaluations ADD COLUMN IF NOT EXISTS position_limit_factors JSONB;

-- 2. Create liquidity milestone alerts table
CREATE TABLE IF NOT EXISTS liquidity_milestone_alerts (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(44) NOT NULL,
  milestone_type VARCHAR(50) NOT NULL,
  threshold NUMERIC(20,2) NOT NULL,
  current_value NUMERIC(20,4) NOT NULL,
  previous_value NUMERIC(20,4) NOT NULL,
  significance VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  actionable BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for milestone alerts
CREATE INDEX IF NOT EXISTS idx_milestone_alerts_token_time 
  ON liquidity_milestone_alerts(token_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestone_alerts_significance 
  ON liquidity_milestone_alerts(significance, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_milestone_alerts_actionable 
  ON liquidity_milestone_alerts(actionable, created_at DESC) 
  WHERE actionable = true;

-- 3. Create liquidity growth snapshots table (optional for historical analysis)
CREATE TABLE IF NOT EXISTS liquidity_growth_snapshots (
  token_address VARCHAR(44) NOT NULL,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  growth_rate_1h NUMERIC(10,4),
  growth_rate_6h NUMERIC(10,4), 
  growth_rate_24h NUMERIC(10,4),
  momentum VARCHAR(20),
  accelerating BOOLEAN,
  current_liquidity_sol NUMERIC(20,4),
  peak_liquidity NUMERIC(20,4),
  time_to_peak NUMERIC(10,2),
  PRIMARY KEY (token_address, time)
);

-- Convert to hypertable for time-series data (if TimescaleDB is available)
SELECT create_hypertable('liquidity_growth_snapshots', 'time', if_not_exists => TRUE);

-- 4. Add liquidity analytics indexes to existing tables for better performance
CREATE INDEX IF NOT EXISTS idx_tokens_liquidity_category 
  ON tokens(liquidity DESC, category) 
  WHERE category IN ('HIGH', 'AIM');

CREATE INDEX IF NOT EXISTS idx_token_prices_liquidity_time 
  ON timeseries.token_prices(token_address, time DESC, liquidity_usd);

CREATE INDEX IF NOT EXISTS idx_token_prices_real_sol_reserves
  ON timeseries.token_prices(token_address, time DESC, real_sol_reserves)
  WHERE real_sol_reserves > 0;

-- 5. Create a view for liquidity analytics summary
CREATE OR REPLACE VIEW liquidity_analytics_summary AS
WITH recent_milestones AS (
  SELECT 
    token_address,
    COUNT(*) as milestone_count,
    MAX(created_at) as last_milestone,
    COUNT(*) FILTER (WHERE significance = 'CRITICAL') as critical_milestones,
    COUNT(*) FILTER (WHERE actionable = true) as actionable_milestones
  FROM liquidity_milestone_alerts 
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY token_address
),
token_liquidity_stats AS (
  SELECT 
    t.address,
    t.symbol,
    t.category,
    t.market_cap,
    t.liquidity * s.price as liquidity_usd,
    t.liquidity,
    CASE 
      WHEN t.liquidity * s.price >= 50000 THEN 'EXCELLENT'
      WHEN t.liquidity * s.price >= 25000 THEN 'HIGH'
      WHEN t.liquidity * s.price >= 7500 THEN 'MEDIUM'
      WHEN t.liquidity * s.price >= 2500 THEN 'LOW'
      ELSE 'VERY_LOW'
    END as liquidity_tier
  FROM tokens t
  CROSS JOIN (
    SELECT price FROM sol_price_history 
    ORDER BY timestamp DESC LIMIT 1
  ) s
  WHERE t.category IN ('HIGH', 'AIM')
    AND t.last_price_update > NOW() - INTERVAL '10 minutes'
)
SELECT 
  tls.*,
  COALESCE(rm.milestone_count, 0) as milestones_24h,
  COALESCE(rm.critical_milestones, 0) as critical_milestones_24h,
  COALESCE(rm.actionable_milestones, 0) as actionable_milestones_24h,
  rm.last_milestone
FROM token_liquidity_stats tls
LEFT JOIN recent_milestones rm ON tls.address = rm.token_address
ORDER BY tls.liquidity_usd DESC;

-- 6. Create a function to get liquidity analytics stats
CREATE OR REPLACE FUNCTION get_liquidity_analytics_stats()
RETURNS TABLE (
  total_tracked_tokens INTEGER,
  excellent_liquidity_tokens INTEGER,
  high_liquidity_tokens INTEGER,
  milestones_24h INTEGER,
  critical_milestones_24h INTEGER,
  top_liquidity_tokens JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH liquidity_stats AS (
    SELECT 
      COUNT(*) as total_tokens,
      COUNT(*) FILTER (WHERE liquidity_tier = 'EXCELLENT') as excellent_tokens,
      COUNT(*) FILTER (WHERE liquidity_tier = 'HIGH') as high_tokens,
      SUM(COALESCE(milestones_24h, 0)) as total_milestones,
      SUM(COALESCE(critical_milestones_24h, 0)) as total_critical,
      jsonb_agg(
        jsonb_build_object(
          'address', address,
          'symbol', symbol,
          'liquidity_usd', liquidity_usd,
          'liquidity_tier', liquidity_tier
        ) ORDER BY liquidity_usd DESC
      ) FILTER (WHERE liquidity_tier IN ('EXCELLENT', 'HIGH')) as top_tokens
    FROM liquidity_analytics_summary
  )
  SELECT 
    total_tokens::INTEGER,
    excellent_tokens::INTEGER, 
    high_tokens::INTEGER,
    total_milestones::INTEGER,
    total_critical::INTEGER,
    COALESCE(top_tokens, '[]'::jsonb)
  FROM liquidity_stats;
END;
$$ LANGUAGE plpgsql;

-- 7. Create materialized view for performance (refresh every 5 minutes)
CREATE MATERIALIZED VIEW IF NOT EXISTS liquidity_performance_summary AS
WITH hourly_growth AS (
  SELECT 
    token_address,
    time_bucket('1 hour', time) as hour,
    first(liquidity_usd, time) as start_liquidity,
    last(liquidity_usd, time) as end_liquidity,
    (last(liquidity_usd, time) - first(liquidity_usd, time)) as hourly_change
  FROM timeseries.token_prices
  WHERE time > NOW() - INTERVAL '24 hours'
    AND liquidity_usd > 0
  GROUP BY token_address, time_bucket('1 hour', time)
),
growth_rates AS (
  SELECT 
    token_address,
    AVG(hourly_change) as avg_hourly_growth,
    MAX(hourly_change) as max_hourly_growth,
    COUNT(*) FILTER (WHERE hourly_change > 0) as positive_hours,
    COUNT(*) as total_hours
  FROM hourly_growth
  GROUP BY token_address
  HAVING COUNT(*) >= 3 -- At least 3 hours of data
)
SELECT 
  t.address,
  t.symbol,
  t.category,
  t.market_cap,
  t.liquidity * sp.price as current_liquidity_usd,
  gr.avg_hourly_growth,
  gr.max_hourly_growth,
  ROUND((gr.positive_hours::NUMERIC / gr.total_hours) * 100, 1) as growth_consistency_pct,
  CASE 
    WHEN gr.avg_hourly_growth > 1000 THEN 'HIGH'
    WHEN gr.avg_hourly_growth > 500 THEN 'MEDIUM'
    WHEN gr.avg_hourly_growth > 0 THEN 'LOW'
    ELSE 'DECLINING'
  END as momentum,
  NOW() as last_updated
FROM tokens t
JOIN growth_rates gr ON t.address = gr.token_address
CROSS JOIN (
  SELECT price FROM sol_price_history 
  ORDER BY timestamp DESC LIMIT 1
) sp
WHERE t.category IN ('HIGH', 'AIM')
ORDER BY gr.avg_hourly_growth DESC;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_liquidity_performance_momentum 
  ON liquidity_performance_summary(momentum, avg_hourly_growth DESC);

-- 8. Create a function to refresh liquidity performance summary
CREATE OR REPLACE FUNCTION refresh_liquidity_performance()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY liquidity_performance_summary;
END;
$$ LANGUAGE plpgsql;

-- 9. Add triggers to update liquidity analytics automatically
CREATE OR REPLACE FUNCTION update_liquidity_milestone_check()
RETURNS TRIGGER AS $$
DECLARE
  prev_liquidity NUMERIC;
  current_liquidity NUMERIC;
BEGIN
  -- Only check for significant changes
  IF NEW.liquidity IS DISTINCT FROM OLD.liquidity 
     AND NEW.category IN ('HIGH', 'AIM') THEN
    
    prev_liquidity := COALESCE(OLD.liquidity, 0);
    current_liquidity := COALESCE(NEW.liquidity, 0);
    
    -- Only trigger if change is > 5% and > 1 SOL
    IF ABS(current_liquidity - prev_liquidity) > 1 
       AND ABS((current_liquidity - prev_liquidity) / GREATEST(prev_liquidity, 0.1)) > 0.05 THEN
      
      -- Insert a notification record that the application can pick up
      INSERT INTO liquidity_milestone_alerts (
        token_address,
        milestone_type,
        threshold,
        current_value,
        previous_value,
        significance,
        message,
        actionable
      ) VALUES (
        NEW.address,
        'LIQUIDITY_CHANGE',
        5.0, -- 5% threshold
        current_liquidity,
        prev_liquidity,
        CASE 
          WHEN ABS((current_liquidity - prev_liquidity) / GREATEST(prev_liquidity, 0.1)) > 0.5 THEN 'HIGH'
          WHEN ABS((current_liquidity - prev_liquidity) / GREATEST(prev_liquidity, 0.1)) > 0.2 THEN 'MEDIUM'
          ELSE 'LOW'
        END,
        format('Liquidity changed from %s to %s SOL (%s%%)', 
               ROUND(prev_liquidity, 2),
               ROUND(current_liquidity, 2),
               ROUND(((current_liquidity - prev_liquidity) / GREATEST(prev_liquidity, 0.1)) * 100, 1)
        ),
        current_liquidity > 10 -- Actionable if > 10 SOL
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on tokens table
DROP TRIGGER IF EXISTS trigger_liquidity_milestone_check ON tokens;
CREATE TRIGGER trigger_liquidity_milestone_check
  AFTER UPDATE ON tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_liquidity_milestone_check();

-- 10. Create cleanup function for old milestone alerts
CREATE OR REPLACE FUNCTION cleanup_old_milestone_alerts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM liquidity_milestone_alerts 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 11. Grant permissions for the application user
GRANT SELECT, INSERT, UPDATE ON liquidity_milestone_alerts TO memecoin_user;
GRANT SELECT, INSERT, UPDATE ON liquidity_growth_snapshots TO memecoin_user;
GRANT SELECT ON liquidity_analytics_summary TO memecoin_user;
GRANT SELECT ON liquidity_performance_summary TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_liquidity_analytics_stats() TO memecoin_user;
GRANT EXECUTE ON FUNCTION refresh_liquidity_performance() TO memecoin_user;
GRANT EXECUTE ON FUNCTION cleanup_old_milestone_alerts() TO memecoin_user;

-- 12. Create a comprehensive liquidity health check view
CREATE OR REPLACE VIEW system_liquidity_health AS
WITH system_stats AS (
  SELECT 
    COUNT(*) as total_aim_tokens,
    COUNT(*) FILTER (WHERE liquidity * (SELECT price FROM sol_price_history ORDER BY timestamp DESC LIMIT 1) >= 7500) as sufficient_liquidity_tokens,
    AVG(liquidity * (SELECT price FROM sol_price_history ORDER BY timestamp DESC LIMIT 1)) as avg_liquidity_usd,
    MAX(liquidity * (SELECT price FROM sol_price_history ORDER BY timestamp DESC LIMIT 1)) as max_liquidity_usd
  FROM tokens 
  WHERE category = 'AIM'
    AND last_price_update > NOW() - INTERVAL '10 minutes'
),
recent_alerts AS (
  SELECT 
    COUNT(*) as alerts_1h,
    COUNT(*) FILTER (WHERE significance = 'CRITICAL') as critical_alerts_1h,
    COUNT(*) FILTER (WHERE actionable = true) as actionable_alerts_1h
  FROM liquidity_milestone_alerts
  WHERE created_at > NOW() - INTERVAL '1 hour'
),
growth_summary AS (
  SELECT 
    COUNT(*) as tokens_with_growth_data,
    COUNT(*) FILTER (WHERE momentum = 'HIGH') as high_momentum_tokens,
    AVG(avg_hourly_growth) as system_avg_growth
  FROM liquidity_performance_summary
  WHERE last_updated > NOW() - INTERVAL '10 minutes'
)
SELECT 
  ss.*,
  ra.*,
  gs.*,
  CASE 
    WHEN ss.sufficient_liquidity_tokens::NUMERIC / GREATEST(ss.total_aim_tokens, 1) > 0.5 THEN 'HEALTHY'
    WHEN ss.sufficient_liquidity_tokens::NUMERIC / GREATEST(ss.total_aim_tokens, 1) > 0.3 THEN 'MODERATE'
    ELSE 'CONCERNING'
  END as liquidity_health_status,
  NOW() as check_timestamp
FROM system_stats ss
CROSS JOIN recent_alerts ra
CROSS JOIN growth_summary gs;

-- Final comment
COMMENT ON VIEW system_liquidity_health IS 'Comprehensive view of system liquidity health for monitoring and alerting';
COMMENT ON TABLE liquidity_milestone_alerts IS 'Real-time liquidity milestone alerts for tokens';
COMMENT ON TABLE liquidity_growth_snapshots IS 'Historical liquidity growth rate snapshots';
COMMENT ON FUNCTION get_liquidity_analytics_stats() IS 'Function to get current liquidity analytics statistics';

-- Success message
SELECT 'Enhanced Liquidity Analytics schema updates completed successfully!' as status;