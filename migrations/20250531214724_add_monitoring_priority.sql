-- Add monitoring_priority and passed_filter_at columns to tokens table

ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS monitoring_priority VARCHAR(20) DEFAULT 'normal';

ALTER TABLE tokens 
ADD COLUMN IF NOT EXISTS passed_filter_at TIMESTAMP;

-- Create index for faster queries on priority tokens
CREATE INDEX IF NOT EXISTS idx_tokens_monitoring_priority ON tokens(monitoring_priority);
CREATE INDEX IF NOT EXISTS idx_tokens_passed_filter_at ON tokens(passed_filter_at);

-- Update existing tokens to have normal priority
UPDATE tokens 
SET monitoring_priority = 'normal' 
WHERE monitoring_priority IS NULL;
