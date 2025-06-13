-- migrations/add_dual_address_support.sql

-- Add pump.fun address column to tokens table
ALTER TABLE public.tokens 
ADD COLUMN IF NOT EXISTS pumpfun_address VARCHAR(44) UNIQUE;

-- Create index for pump.fun address lookups
CREATE INDEX IF NOT EXISTS idx_tokens_pumpfun_address 
ON public.tokens(pumpfun_address);

-- Create dual address mapping table for quick lookups
CREATE TABLE IF NOT EXISTS public.token_address_mapping (
  spl_address VARCHAR(44) NOT NULL,
  pumpfun_address VARCHAR(44) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (spl_address),
  UNIQUE(pumpfun_address)
);

-- Create indexes for both directions
CREATE INDEX idx_address_mapping_spl ON public.token_address_mapping(spl_address);
CREATE INDEX idx_address_mapping_pumpfun ON public.token_address_mapping(pumpfun_address);

-- Update existing tokens with pump.fun addresses if we have bonding curve data
UPDATE public.tokens t
SET pumpfun_address = t.bonding_curve
WHERE t.bonding_curve IS NOT NULL 
  AND t.pumpfun_address IS NULL;

-- Create function for universal address lookup
CREATE OR REPLACE FUNCTION get_token_by_any_address(input_address VARCHAR)
RETURNS TABLE (
  address VARCHAR,
  spl_address VARCHAR,
  pumpfun_address VARCHAR,
  symbol VARCHAR,
  name VARCHAR,
  category VARCHAR,
  market_cap DECIMAL,
  current_price_usd NUMERIC,
  current_price_sol NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.address,
    t.address as spl_address,
    t.pumpfun_address,
    t.symbol,
    t.name,
    t.category,
    t.market_cap,
    t.current_price_usd,
    t.current_price_sol
  FROM public.tokens t
  WHERE t.address = input_address 
     OR t.pumpfun_address = input_address
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to maintain address mapping table
CREATE OR REPLACE FUNCTION maintain_address_mapping()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update mapping
  INSERT INTO public.token_address_mapping (spl_address, pumpfun_address, updated_at)
  VALUES (NEW.address, NEW.pumpfun_address, NOW())
  ON CONFLICT (spl_address) 
  DO UPDATE SET 
    pumpfun_address = EXCLUDED.pumpfun_address,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_maintain_address_mapping
AFTER INSERT OR UPDATE OF pumpfun_address ON public.tokens
FOR EACH ROW
WHEN (NEW.pumpfun_address IS NOT NULL)
EXECUTE FUNCTION maintain_address_mapping();