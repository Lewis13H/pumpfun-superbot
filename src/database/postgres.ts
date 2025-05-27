import knex from 'knex';
import { config } from '../config';
import { logger } from '../utils/logger';

export const db = knex({
  client: 'pg',
  connection: {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
  },
  pool: {
    min: 2,
    max: 10,
  },
});

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