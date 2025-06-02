-- Fix schema_migrations table

BEGIN;

-- Drop and recreate schema_migrations with larger column
DROP TABLE IF EXISTS schema_migrations;

CREATE TABLE schema_migrations (
  version VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW()
);

COMMIT;
