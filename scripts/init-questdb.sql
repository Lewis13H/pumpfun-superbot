CREATE TABLE IF NOT EXISTS token_metrics (
  address SYMBOL,
  price DOUBLE,
  market_cap DOUBLE,
  volume_24h DOUBLE,
  holders INT,
  safety_score DOUBLE,
  timestamp TIMESTAMP
) timestamp(timestamp) PARTITION BY DAY;

CREATE TABLE IF NOT EXISTS discovery_events (
  token_address SYMBOL,
  platform SYMBOL,
  event_type SYMBOL,
  details STRING,
  timestamp TIMESTAMP
) timestamp(timestamp) PARTITION BY DAY;