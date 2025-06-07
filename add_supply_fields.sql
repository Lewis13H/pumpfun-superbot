-- Add supply fields to tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS total_supply NUMERIC(40,0),
ADD COLUMN IF NOT EXISTS max_supply NUMERIC(40,0),
ADD COLUMN IF NOT EXISTS circulating_supply NUMERIC(40,0);

-- Add supply fields to token_prices for historical tracking
ALTER TABLE timeseries.token_prices
ADD COLUMN IF NOT EXISTS total_supply NUMERIC(40,0);
