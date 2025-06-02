-- First, update current_price with price values where current_price is null
UPDATE tokens 
SET current_price = price 
WHERE current_price IS NULL AND price IS NOT NULL;

-- Drop the redundant price column
ALTER TABLE tokens DROP COLUMN IF EXISTS price;

-- Verify the change
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'tokens' 
AND column_name IN ('price', 'current_price');
