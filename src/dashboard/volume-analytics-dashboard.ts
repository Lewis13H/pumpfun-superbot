// src/dashboard/volume-analytics-dashboard.ts
// V4.27: Real-time Volume Analytics Dashboard

import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import { VOLUME_ANALYTICS_SERVICE } from '../services/volume-analytics-service';

export class VolumeAnalyticsDashboard {
  private isRunning = false;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.setupKeyboardHandlers();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Dashboard already running');
      return;
    }

    console.clear();
    console.log('🚀 Starting Volume Analytics Dashboard V4.27...\n');

    try {
      // Test database connection
      await db.raw('SELECT NOW()');
      
      // Initialize volume analytics service if not running
      if (!VOLUME_ANALYTICS_SERVICE.getStats().isRunning) {
        await VOLUME_ANALYTICS_SERVICE.start();
      }

      this.isRunning = true;
      await this.displayInitialScreen();
      this.startRefreshLoop();

      console.log('\n📊 Dashboard Controls:');
      console.log('  [R] - Refresh data');
      console.log('  [1] - Show 1h volume leaders');
      console.log('  [4] - Show 4h volume leaders');  
      console.log('  [D] - Show 24h volume leaders');
      console.log('  [A] - Show recent alerts');
      console.log('  [S] - Show service stats');
      console.log('  [Q] - Quit dashboard');
      console.log('\nPress any key to start...\n');

    } catch (error) {
      console.error('❌ Failed to start dashboard:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    console.log('🛑 Volume Analytics Dashboard stopped');
  }

  private setupKeyboardHandlers(): void {
    // Enable raw mode for real-time key detection
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', async (key: string) => {
      const input = key.toString().toLowerCase();

      switch (input) {
        case 'q':
        case '\u0003': // Ctrl+C
          await this.stop();
          process.exit(0);
          break;

        case 'r':
          await this.refreshDisplay();
          break;

        case '1':
          await this.showVolumeLeaders('1h');
          break;

        case '4':
          await this.showVolumeLeaders('4h');
          break;

        case 'd':
          await this.showVolumeLeaders('24h');
          break;

        case 'a':
          await this.showRecentAlerts();
          break;

        case 's':
          await this.showServiceStats();
          break;

        default:
          // Any other key refreshes
          await this.refreshDisplay();
          break;
      }
    });
  }

  private async displayInitialScreen(): Promise<void> {
    console.clear();
    this.printHeader();
    await this.displayOverview();
  }

  private printHeader(): void {
    console.log('█'.repeat(100));
    console.log('█' + ' '.repeat(98) + '█');
    console.log('█' + ' '.repeat(25) + '🚀 VOLUME ANALYTICS DASHBOARD V4.27' + ' '.repeat(25) + '█');
    console.log('█' + ' '.repeat(35) + 'Real-time Token Volume Tracking' + ' '.repeat(32) + '█');
    console.log('█' + ' '.repeat(98) + '█');
    console.log('█'.repeat(100));
    console.log();
  }

  private async displayOverview(): Promise<void> {
    try {
      // Get service stats
      const serviceStats = VOLUME_ANALYTICS_SERVICE.getStats();
      
      // Get quick summary
      const [mediumSummary, highSummary, aimSummary] = await Promise.all([
        VOLUME_ANALYTICS_SERVICE.getVolumeSummary('MEDIUM', 5),
        VOLUME_ANALYTICS_SERVICE.getVolumeSummary('HIGH', 5),
        VOLUME_ANALYTICS_SERVICE.getVolumeSummary('AIM', 5)
      ]);

      // Get recent alerts
      const recentAlerts = await VOLUME_ANALYTICS_SERVICE.getRecentAlerts(5);

      console.log('📊 SERVICE STATUS:');
      console.log(`   Running: ${serviceStats.isRunning ? '✅' : '❌'}`);
      console.log(`   Tokens Tracked: ${serviceStats.tokensTracked}`);
      console.log(`   Alerts Triggered: ${serviceStats.alertsTriggered}`);
      console.log(`   Total Calculations: ${serviceStats.totalCalculations}`);
      console.log(`   Processing Errors: ${serviceStats.processingErrors}`);
      console.log(`   Last Update: ${new Date(serviceStats.lastUpdateTime).toLocaleTimeString()}`);
      console.log();

      console.log('🎯 CATEGORY OVERVIEW:');
      console.log(`   MEDIUM ($15k-$35k MC): ${mediumSummary.length} active tokens`);
      console.log(`   HIGH ($35k-$105k MC): ${highSummary.length} active tokens`);
      console.log(`   AIM ($105k+ MC): ${aimSummary.length} active tokens`);
      console.log();

      if (recentAlerts.length > 0) {
        console.log('🚨 RECENT ALERTS:');
        recentAlerts.slice(0, 3).forEach((alert, index) => {
          const timeAgo = this.getTimeAgo(new Date(alert.triggeredAt));
          console.log(`   ${index + 1}. [${alert.severity}] ${alert.symbol}: ${alert.message} (${timeAgo})`);
        });
        console.log();
      }

      // Top performers
      const topPerformers = await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard('1h');
      if (topPerformers.length > 0) {
        console.log('🏆 TOP VOLUME PERFORMERS (1H):');
        topPerformers.slice(0, 5).forEach((metrics, index) => {
          console.log(`   ${index + 1}. ${this.getTokenSymbol(metrics.tokenAddress)} | $${this.formatNumber(metrics.totalVolumeUsd)} | ${metrics.totalTransactions} txs | ${metrics.buyVolumeRatio.toFixed(1)}% buys`);
        });
        console.log();
      }

    } catch (error) {
      console.log('❌ Error displaying overview:', error);
    }
  }

  private async showVolumeLeaders(timeWindow: '1h' | '4h' | '24h'): Promise<void> {
    console.clear();
    this.printHeader();
    
    try {
      const leaders = await VOLUME_ANALYTICS_SERVICE.getVolumeLeaderboard(timeWindow);
      
      console.log(`🏆 TOP VOLUME PERFORMERS (${timeWindow.toUpperCase()})`);
      console.log('─'.repeat(100));
      console.log('Rank | Symbol    | Volume USD    | Txs  | Buy% | Sell% | Category | Market Cap');
      console.log('─'.repeat(100));
      
      if (leaders.length === 0) {
        console.log('No volume data available for the selected timeframe.');
      } else {
        leaders.slice(0, 20).forEach((metrics, index) => {
          const symbol = this.getTokenSymbol(metrics.tokenAddress).padEnd(9);
          const volumeUsd = this.formatNumber(metrics.totalVolumeUsd).padStart(12);
          const txs = metrics.totalTransactions.toString().padStart(4);
          const buyRatio = metrics.buyVolumeRatio.toFixed(1).padStart(4);
          const sellRatio = metrics.sellVolumeRatio.toFixed(1).padStart(4);
          const category = metrics.category.padEnd(8);
          const marketCap = this.formatNumber(metrics.currentMarketCap);
          
          console.log(`${(index + 1).toString().padStart(4)} | ${symbol} | ${volumeUsd} | ${txs} | ${buyRatio}% | ${sellRatio}% | ${category} | $${marketCap}`);
        });
      }
      
    } catch (error) {
      console.log('❌ Error showing volume leaders:', error);
    }
    
    console.log('\nPress any key to return to overview...');
  }

  private async showRecentAlerts(): Promise<void> {
    console.clear();
    this.printHeader();
    
    try {
      const alerts = await VOLUME_ANALYTICS_SERVICE.getRecentAlerts(25);
      
      console.log('🚨 RECENT VOLUME ALERTS');
      console.log('─'.repeat(100));
      console.log('Time     | Severity | Type              | Symbol    | Message');
      console.log('─'.repeat(100));
      
      if (alerts.length === 0) {
        console.log('No recent alerts.');
      } else {
        alerts.forEach((alert) => {
          const time = new Date(alert.triggeredAt).toLocaleTimeString().substring(0, 8);
          const severity = alert.severity.padEnd(8);
          const type = alert.alertType.replace('_', ' ').padEnd(17);
          const symbol = alert.symbol.substring(0, 9).padEnd(9);
          const message = alert.message.substring(0, 50);
          
          console.log(`${time} | ${severity} | ${type} | ${symbol} | ${message}`);
        });
      }
      
    } catch (error) {
      console.log('❌ Error showing alerts:', error);
    }
    
    console.log('\nPress any key to return to overview...');
  }

  private async showServiceStats(): Promise<void> {
    console.clear();
    this.printHeader();
    
    try {
      const stats = VOLUME_ANALYTICS_SERVICE.getStats();
      
      console.log('⚙️ VOLUME ANALYTICS SERVICE STATISTICS');
      console.log('─'.repeat(100));
      console.log();
      
      console.log('📊 PERFORMANCE METRICS:');
      console.log(`   Service Running: ${stats.isRunning ? '✅ Yes' : '❌ No'}`);
      console.log(`   Tokens Tracked: ${stats.tokensTracked}`);
      console.log(`   Tokens in Cache: ${stats.tokensInCache}`);
      console.log(`   Total Calculations: ${stats.totalCalculations}`);
      console.log(`   Alerts Triggered: ${stats.alertsTriggered}`);
      console.log(`   Processing Errors: ${stats.processingErrors}`);
      console.log(`   Alert History Size: ${stats.alertHistorySize}`);
      console.log();
      
      console.log('⏰ TIMING:');
      console.log(`   Last Update: ${new Date(stats.lastUpdateTime).toLocaleString()}`);
      console.log();
      
      console.log('⚙️ CONFIGURATION:');
      console.log(`   Volume Spike Thresholds:`);
      console.log(`     Low: ${stats.config.volumeSpikeThresholds.low}%`);
      console.log(`     Medium: ${stats.config.volumeSpikeThresholds.medium}%`);
      console.log(`     High: ${stats.config.volumeSpikeThresholds.high}%`);
      console.log(`     Critical: ${stats.config.volumeSpikeThresholds.critical}%`);
      console.log();
      console.log(`   Imbalance Thresholds:`);
      console.log(`     Moderate: ${stats.config.imbalanceThresholds.moderate}%`);
      console.log(`     Severe: ${stats.config.imbalanceThresholds.severe}%`);
      console.log(`     Extreme: ${stats.config.imbalanceThresholds.extreme}%`);
      console.log();
      console.log(`   Minimum Volume USD: $${stats.config.minimumVolumeUsd}`);
      
    } catch (error) {
      console.log('❌ Error showing service stats:', error);
    }
    
    console.log('\nPress any key to return to overview...');
  }

  private startRefreshLoop(): void {
    this.refreshInterval = setInterval(async () => {
      if (this.isRunning) {
        // Auto-refresh every 30 seconds
        await this.refreshDisplay();
      }
    }, 30000);
  }

  private async refreshDisplay(): Promise<void> {
    await this.displayInitialScreen();
  }

  private getTokenSymbol(tokenAddress: string): string {
    // This would typically cache token symbols, but for now return truncated address
    return tokenAddress.substring(0, 8) + '...';
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    } else {
      return num.toFixed(0);
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) {
      return 'just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    }
  }
}

// CLI entry point
export async function startVolumeAnalyticsDashboard(): Promise<void> {
  const dashboard = new VolumeAnalyticsDashboard();
  
  try {
    await dashboard.start();
  } catch (error) {
    console.error('Failed to start Volume Analytics Dashboard:', error);
    process.exit(1);
  }
}

// Start dashboard if this file is run directly
if (require.main === module) {
  startVolumeAnalyticsDashboard();
}