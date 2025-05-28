import { Router } from 'express';
import { db, testConnection as testPostgres } from '../database/postgres';
import { logger } from '../utils/logger';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  };
  
  res.json(health);
});

healthRouter.get('/detailed', async (req, res) => {
  const checks = {
    postgres: false,
    questdb: false,
  };
  
  // Check PostgreSQL
  try {
    checks.postgres = await testPostgres();
  } catch (error) {
    logger.error('PostgreSQL health check failed', error);
  }
  
  // QuestDB check disabled for now
  checks.questdb = false;
  
  const allHealthy = checks.postgres;
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
    uptime: process.uptime(),
  });
});