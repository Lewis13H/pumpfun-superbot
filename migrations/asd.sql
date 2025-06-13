-- migrations/add_dual_address_support.sql

-- Add pump.fun vanity address support to tokens table
ALTER TABLE public.tokens 
ADD COLUMN IF NOT EXISTS pump_vanity_address VARCHAR(44),
ADD COLUMN IF NOT EXISTS address_extraction_method VARCHAR(50),
ADD COLUMN IF NOT EXISTS address_confidence VARCHAR(20) DEFAULT 'high',
ADD COLUMN IF NOT EXISTS vanity_address_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS addresses_linked_at TIMESTAMPTZ;

-- Create index for vanity address lookups
CREATE INDEX IF NOT EXISTS idx_tokens_pump_vanity_address 
ON public.tokens(pump_vanity_address) 
WHERE pump_vanity_address IS NOT NULL;

-- Create composite index for dual address lookups
CREATE INDEX IF NOT EXISTS idx_tokens_dual_addresses 
ON public.tokens(address, pump_vanity_address);

-- Add address mappings table for tracking all discovered addresses
CREATE TABLE IF NOT EXISTS public.token_address_mappings (
  id SERIAL PRIMARY KEY,
  spl_address VARCHAR(44) NOT NULL,
  pump_vanity_address VARCHAR(44),
  extraction_method VARCHAR(50) NOT NULL,
  confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
  transaction_signature VARCHAR(88),
  slot BIGINT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(spl_address, pump_vanity_address)
);

-- Create indexes for address mappings
CREATE INDEX idx_address_mappings_spl ON public.token_address_mappings(spl_address);
CREATE INDEX idx_address_mappings_vanity ON public.token_address_mappings(pump_vanity_address);