// Ensure dotenv is loaded FIRST
import dotenv from 'dotenv';
dotenv.config();

import knex from 'knex';
import { logger } from '../utils/logger2';

export const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
  },
  pool: {
    min: 5,
    max: 30,  // Increased from 10
    acquireTimeoutMillis: 60000,  // 60 seconds
    createTimeoutMillis: 30000,   // 30 seconds
    destroyTimeoutMillis: 5000,   // 5 seconds
    idleTimeoutMillis: 30000,     // 30 seconds
    reapIntervalMillis: 1000,     // 1 second
    createRetryIntervalMillis: 100,
  },
  log: {
    warn(message: any) {
      logger.warn('Database warning:', message);
    },
    error(message: any) {
      logger.error('Database error:', message);
    },
    deprecate(message: any) {
      logger.warn('Database deprecation:', message);
    },
    debug(message: any) {
      logger.debug('Database debug:', message);
    },
  }
});

// Monitor pool health
setInterval(() => {
  const pool = db.client.pool;
  if (pool) {
    const used = pool.numUsed();
    const free = pool.numFree();
    const pending = pool.numPendingAcquires();
    
    if (used > 20 || pending > 5) {
      logger.warn(`DB Pool Alert - Used: ${used}, Free: ${free}, Pending: ${pending}`);
    }
  }
}, 30000); // Check every 30 seconds

export async function testConnection(): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connection successful');
    return true;
  } catch (error) {
    logger.error('PostgreSQL connection failed', error);
    return false;
  }
}