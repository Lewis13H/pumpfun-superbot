// src/database/postgres-js.js - JavaScript database connection for Helius service

const knex = require('knex');

// Database configuration
const dbConfig = {
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD || 'Bhaal1313!!',
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

// Create database connection
const db = knex(dbConfig);

// Test connection on startup
db.raw('SELECT NOW()')
  .then(() => {
    console.log('✅ JavaScript database connection established');
  })
  .catch((error) => {
    console.error('❌ JavaScript database connection failed:', error.message);
  });

module.exports = { db };