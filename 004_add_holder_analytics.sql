-- database/migrations/004_add_holder_analytics.sql
-- V4.23: Add holder analytics columns to tokens table

-- Add new columns for holder analytics
ALTER TABLE public.tokens 
ADD COLUMN IF NOT EXISTS top_25_percent DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS holder_distribution JSONB,
ADD COLUMN IF NOT EXISTS holder_data_source VARCHAR(20),
ADD COLUMN IF NOT EXISTS holder_last_updated TIMESTAMPTZ;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_tokens_holders ON public.tokens(holders) WHERE holders IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_top_10_percent ON public.tokens(top_10_percent) WHERE top_10_percent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_top_25_percent ON public.tokens(top_25_percent) WHERE top_25_percent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_holder_last_updated ON public.tokens(holder_last_updated);
CREATE INDEX IF NOT EXISTS idx_tokens_category_holders ON public.tokens(category, holders) WHERE holders IS NOT NULL;

-- Add composite index for buy signal evaluation
CREATE INDEX IF NOT EXISTS idx_tokens_buy_signals 
ON public.tokens(category, market_cap, holders, top_10_percent) 
WHERE category = 'AIM' AND holders IS NOT NULL;

-- Create view for holder analytics dashboard
CREATE OR REPLACE VIEW token_holder_analytics AS
SELECT 
  address,
  symbol,
  name,
  category,
  market_cap,
  holders,
  top_10_percent,
  top_25_percent,
  holder_distribution,
  holder_data_source,
  holder_last_updated,
  CASE 
    WHEN holder_last_updated IS NULL THEN 'Never updated'
    WHEN holder_last_updated < NOW() - INTERVAL '1 hour' THEN 'Stale (>1h)'
    WHEN holder_last_updated < NOW() - INTERVAL '30 minutes' THEN 'Recent (30m-1h)'
    ELSE 'Fresh (<30m)'
  END as data_freshness,
  CASE
    WHEN holders IS NULL THEN 'No data'
    WHEN holders < 30 THEN 'Very Low (<30)'
    WHEN holders < 100 THEN 'Low (30-100)'
    WHEN holders < 500 THEN 'Medium (100-500)'
    WHEN holders < 1000 THEN 'High (500-1000)'
    ELSE 'Very High (>1000)'
  END as holder_category,
  CASE
    WHEN top_10_percent IS NULL THEN 'No data'
    WHEN top_10_percent > 50 THEN 'Very High (>50%)'
    WHEN top_10_percent > 30 THEN 'High (30-50%)'
    WHEN top_10_percent > 20 THEN 'Medium (20-30%)'
    WHEN top_10_percent > 10 THEN 'Low (10-20%)'
    ELSE 'Very Low (<10%)'
  END as concentration_category
FROM public.tokens
WHERE category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
ORDER BY 
  CASE category 
    WHEN 'AIM' THEN 1 
    WHEN 'HIGH' THEN 2 
    WHEN 'MEDIUM' THEN 3 
    WHEN 'LOW' THEN 4 
    WHEN 'NEW' THEN 5 
  END,
  market_cap DESC;

-- Create function to get tokens needing holder updates
CREATE OR REPLACE FUNCTION get_tokens_needing_holder_updates(
  category_filter TEXT DEFAULT NULL,
  minutes_old INTEGER DEFAULT 15
) RETURNS TABLE (
  token_address VARCHAR(44),
  symbol VARCHAR(20),
  category VARCHAR(20),
  market_cap DECIMAL(30,2),
  priority INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.address,
    t.symbol,
    t.category,
    t.market_cap,
    CASE t.category
      WHEN 'AIM' THEN 1
      WHEN 'HIGH' THEN 2
      WHEN 'MEDIUM' THEN 3
      WHEN 'LOW' THEN 4
      WHEN 'NEW' THEN 5
      ELSE 6
    END as priority
  FROM public.tokens t
  WHERE 
    (category_filter IS NULL OR t.category = category_filter)
    AND (
      t.holder_last_updated IS NULL 
      OR t.holder_last_updated < NOW() - (minutes_old || ' minutes')::INTERVAL
    )
    AND t.category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
  ORDER BY priority, t.market_cap DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql;

-- Create summary statistics function
CREATE OR REPLACE FUNCTION get_holder_analytics_stats()
RETURNS TABLE (
  category VARCHAR(20),
  total_tokens BIGINT,
  with_holder_data BIGINT,
  avg_holders NUMERIC,
  avg_top_10_concentration NUMERIC,
  fresh_data_count BIGINT,
  stale_data_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.category,
    COUNT(*) as total_tokens,
    COUNT(t.holders) as with_holder_data,
    ROUND(AVG(t.holders), 0) as avg_holders,
    ROUND(AVG(t.top_10_percent), 2) as avg_top_10_concentration,
    COUNT(CASE WHEN t.holder_last_updated > NOW() - INTERVAL '1 hour' THEN 1 END) as fresh_data_count,
    COUNT(CASE WHEN t.holder_last_updated <= NOW() - INTERVAL '1 hour' THEN 1 END) as stale_data_count
  FROM public.tokens t
  WHERE t.category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
  GROUP BY t.category
  ORDER BY 
    CASE t.category 
      WHEN 'AIM' THEN 1 
      WHEN 'HIGH' THEN 2 
      WHEN 'MEDIUM' THEN 3 
      WHEN 'LOW' THEN 4 
      WHEN 'NEW' THEN 5 
    END;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON COLUMN public.tokens.top_25_percent IS 'Percentage of total supply held by top 25% of holders';
COMMENT ON COLUMN public.tokens.holder_distribution IS 'JSON object containing detailed holder distribution data';
COMMENT ON COLUMN public.tokens.holder_data_source IS 'Source of holder data: helius_das, helius_enhanced, or fallback';
COMMENT ON COLUMN public.tokens.holder_last_updated IS 'Timestamp when holder data was last updated';

-- Grant permissions
GRANT SELECT ON token_holder_analytics TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_tokens_needing_holder_updates(TEXT, INTEGER) TO memecoin_user;
GRANT EXECUTE ON FUNCTION get_holder_analytics_stats() TO memecoin_user;

-- Example queries for testing:
/*
-- Test the migration
SELECT address, symbol, holders, top_10_percent, top_25_percent, holder_last_updated 
FROM tokens 
WHERE category = 'AIM' 
LIMIT 5;

-- Test the view
SELECT * FROM token_holder_analytics WHERE category = 'AIM' LIMIT 10;

-- Test the function
SELECT * FROM get_tokens_needing_holder_updates('AIM', 15);

-- Test statistics
SELECT * FROM get_holder_analytics_stats();
*/