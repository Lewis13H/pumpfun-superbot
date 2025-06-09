// Create a test monitoring script: src/test/monitor-grpc.ts

import { db } from '../database/postgres';
import { logger } from '../utils/logger2';

export class GrpcMonitor {
  private stats = {
    priceUpdates: 0,
    newTokens: 0,
    transactions: 0,
    graduations: 0,
    errors: 0,
    startTime: new Date()
  };

  async startMonitoring() {
    logger.info('📊 Starting gRPC monitoring...');
    
    // Monitor stats every 10 seconds
    setInterval(() => this.displayStats(), 10000);
    
    // Monitor database changes
    setInterval(() => this.checkDatabase(), 30000);
  }

  private displayStats() {
    const runtime = Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000);
    logger.info('📈 gRPC Stats:', {
      runtime: `${runtime}s`,
      ...this.stats
    });
  }

  private async checkDatabase() {
    try {
      // Check for new tokens
      const newTokens = await db('tokens')
        .where('created_at', '>', new Date(Date.now() - 60000))
        .count('* as count');
      
      // Check for recent price updates
      const priceUpdates = await db('timeseries.token_prices')
        .where('time', '>', new Date(Date.now() - 60000))
        .count('* as count');
      
      // Check for recent transactions
      const transactions = await db('timeseries.token_transactions')
        .where('time', '>', new Date(Date.now() - 60000))
        .count('* as count');
      
      logger.info('💾 Database Activity (last minute):', {
        newTokens: newTokens[0].count,
        priceUpdates: priceUpdates[0].count,
        transactions: transactions[0].count
      });
      
    } catch (error) {
      logger.error('Error checking database:', error);
    }
  }

  incrementPriceUpdate() { this.stats.priceUpdates++; }
  incrementNewToken() { this.stats.newTokens++; }
  incrementTransaction() { this.stats.transactions++; }
  incrementGraduation() { this.stats.graduations++; }
  incrementError() { this.stats.errors++; }
}