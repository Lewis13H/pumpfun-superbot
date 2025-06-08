// src/api/monitor.ts - API Monitor endpoints
import { Router } from 'express';
import { logger } from '../utils/logger2';

const router = Router();

// In-memory storage for API metrics (in production, use Redis or DB)
const apiMetrics = new Map<string, any>();
const errorLogs: any[] = [];

router.get('/status', (req, res) => {
  // Simulated API service status - replace with actual monitoring
  const services = [
    {
      name: 'SolSniffer',
      status: 'operational',
      responseTime: 245,
      successRate: 98.5,
      dailyCost: 3.42,
      dailyLimit: 10,
      requestsToday: 342,
      lastChecked: new Date().toISOString()
    },
    {
      name: 'Birdeye',
      status: 'operational',
      responseTime: 180,
      successRate: 99.2,
      dailyCost: 2.15,
      dailyLimit: 5,
      requestsToday: 215,
      lastChecked: new Date().toISOString()
    },
    {
      name: 'DexScreener',
      status: 'operational',
      responseTime: 120,
      successRate: 99.8,
      dailyCost: 0,
      dailyLimit: 0,
      requestsToday: 1842,
      lastChecked: new Date().toISOString()
    },
    {
      name: 'Moralis',
      status: 'degraded',
      responseTime: 450,
      successRate: 94.3,
      dailyCost: 1.85,
      dailyLimit: 3,
      requestsToday: 185,
      lastError: 'Rate limit exceeded',
      lastChecked: new Date().toISOString()
    },
    {
      name: 'Helius',
      status: 'operational',
      responseTime: 90,
      successRate: 99.9,
      dailyCost: 8.00,
      dailyLimit: 99,
      requestsToday: 2400,
      lastChecked: new Date().toISOString()
    }
  ];

  const totalDailyCost = services.reduce((sum, service) => sum + service.dailyCost, 0);

  res.json({
    services,
    totalDailyCost
  });
});

router.get('/cost-history', (req, res) => {
  // Generate mock cost history for last 24 hours
  const history = [];
  const now = new Date();
  
  for (let i = 23; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    history.push({
      time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cost: 10 + Math.random() * 10 + (23 - i) * 0.3,
      requests: Math.floor(200 + Math.random() * 300 + (23 - i) * 10)
    });
  }

  res.json(history);
});

router.get('/errors', (req, res) => {
  // Return recent error logs
  const errors = [
    {
      id: '1',
      service: 'Moralis',
      error: 'Rate limit exceeded - 429 Too Many Requests',
      timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      severity: 'medium'
    },
    {
      id: '2',
      service: 'SolSniffer',
      error: 'Token analysis timeout after 30s',
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      severity: 'low'
    },
    {
      id: '3',
      service: 'Birdeye',
      error: 'Invalid API response format',
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      severity: 'low'
    }
  ];

  res.json(errors.slice(0, 50)); // Return last 50 errors
});

export default router;
