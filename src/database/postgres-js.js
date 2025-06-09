// src/database/postgres-js.js - JavaScript database connection for Helius service
// 🔒 SECURITY FIXED: No hardcoded passwords

const knex = require('knex');

// 🔒 SECURITY: Ensure environment variables are properly loaded
require('dotenv').config();

// Database configuration - SECURE (no hardcoded passwords)
const dbConfig = {
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD, // 🔒 FIXED: No hardcoded fallback
  },
  pool: {
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 200,
  },
  acquireConnectionTimeout: 60000,
  debug: false
};

// 🔒 VALIDATION: Check critical environment variables
if (!process.env.POSTGRES_PASSWORD) {
  console.error('❌ SECURITY ERROR: POSTGRES_PASSWORD environment variable is required!');
  console.error('   Please set this in your .env file or environment variables');
  process.exit(1);
}

// Create database connection
const db = knex(dbConfig);

// Test connection on startup with enhanced error handling
db.raw('SELECT NOW()')
  .then((result) => {
    console.log('✅ JavaScript database connection established');
    console.log('✅ Database connected:', result.rows[0].now);
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error.message);
    console.error('💡 Check your environment variables:');
    console.error('   - POSTGRES_HOST');
    console.error('   - POSTGRES_PORT');
    console.error('   - POSTGRES_USER');
    console.error('   - POSTGRES_PASSWORD');
    console.error('   - POSTGRES_DB');
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔌 Closing database connection...');
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔌 Closing database connection...');
  await db.destroy();
  process.exit(0);
});

module.exports = {
  db,
  knex // Export knex for advanced usage
};