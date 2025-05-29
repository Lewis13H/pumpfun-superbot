-- Migration: Add graduation tracking columns
-- Date: 2025-05-29
-- Description: Add columns and indexes for pump.fun token graduation tracking

-- Add graduation tracking columns to tokens table
ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS distance_to_graduation DECIMAL(20,2),
ADD COLUMN IF NOT EXISTS estimated_graduation_time INTEGER;

-- Add graduation tracking to pump_fun_curve_snapshots
ALTER TABLE pump_fun_curve_snapshots
ADD COLUMN IF NOT EXISTS distance_to_graduation DECIMAL(20,2);

-- Create index for efficient graduation queries
CREATE INDEX IF NOT EXISTS idx_tokens_graduation 
ON tokens(platform, curve_progress) 
WHERE platform = 'pumpfun' AND curve_progress > 50;

-- Create index for curve snapshots
CREATE INDEX IF NOT EXISTS idx_curve_snapshots_progress
ON pump_fun_curve_snapshots(token_address, curve_progress);

-- Create index for tracking active pump.fun tokens
CREATE INDEX IF NOT EXISTS idx_tokens_pumpfun_active
ON tokens(address, bonding_curve)
WHERE platform = 'pumpfun' AND is_pump_fun = true;

-- Add comment to new columns
COMMENT ON COLUMN tokens.distance_to_graduation IS 'SOL amount needed to reach Raydium migration (69,420 SOL target)';
COMMENT ON COLUMN tokens.estimated_graduation_time IS 'Estimated minutes until graduation based on recent growth rate';
COMMENT ON COLUMN pump_fun_curve_snapshots.distance_to_graduation IS 'Historical tracking of distance to graduation';