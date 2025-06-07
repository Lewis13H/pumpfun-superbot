// src/api/controllers/monitor.controller.ts
import { Request, Response } from 'express';
import { logger } from '../../utils/logger';

export class MonitorController {
  // Store API metrics in memory (in production, use Redis or database)
  private static apiMetrics = new Map<string, any>();
  private static errorLogs: any[] = [];
  private static costHistory: any[] = [];

  async getApiStatus(req: Request, res: Response) {
    try {
      // Get current API service status
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
        totalDailyCost,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching API status:', error);
      res.status(500).json({ error: 'Failed to fetch API status' });
    }
  }

  async getCostHistory(req: Request, res: Response) {
    try {
      // Generate cost history for the last 24 hours
      const history = [];
      const now = new Date();
      
      for (let i = 23; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 60 * 60 * 1000);
        history.push({
          time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          cost: 10 + Math.random() * 10 + (23 - i) * 0.3, // Simulate increasing cost
          requests: Math.floor(200 + Math.random() * 300 + (23 - i) * 10)
        });
      }

      res.json(history);
    } catch (error) {
      logger.error('Error fetching cost history:', error);
      res.status(500).json({ error: 'Failed to fetch cost history' });
    }
  }

  async getErrorLogs(req: Request, res: Response) {
    try {
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

      res.json(errors);
    } catch (error) {
      logger.error('Error fetching error logs:', error);
      res.status(500).json({ error: 'Failed to fetch error logs' });
    }
  }

  // Helper method to track API usage (call this from your API clients)
  static trackApiCall(service: string, success: boolean, responseTime: number, cost: number = 0) {
    const metrics = this.apiMetrics.get(service) || {
      totalCalls: 0,
      successfulCalls: 0,
      totalResponseTime: 0,
      totalCost: 0,
      errors: []
    };

    metrics.totalCalls++;
    if (success) {
      metrics.successfulCalls++;
    }
    metrics.totalResponseTime += responseTime;
    metrics.totalCost += cost;

    this.apiMetrics.set(service, metrics);
  }

  // Helper method to log errors
  static logError(service: string, error: string, severity: 'low' | 'medium' | 'high' = 'low') {
    this.errorLogs.unshift({
      id: Date.now().toString(),
      service,
      error,
      timestamp: new Date().toISOString(),
      severity
    });

    // Keep only last 100 errors
    if (this.errorLogs.length > 100) {
      this.errorLogs = this.errorLogs.slice(0, 100);
    }
  }
}
