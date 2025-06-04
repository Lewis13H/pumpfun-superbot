import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';
import { categoryManager } from '../category/category-manager';
import { buySignalService } from '../trading/buy-signal-service';

export interface Alert {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: any;
  timestamp: Date;
}

export class AlertManager extends EventEmitter {
  private alerts: Alert[] = [];
  
  async checkAlerts(): Promise<void> {
    // Check for rapid AIM entries
    const recentAimEntries = await db('category_transitions')
      .where('to_category', 'AIM')
      .where('created_at', '>', new Date(Date.now() - 10 * 60 * 1000))
      .count('* as count')
      .first();
    
    if (Number(recentAimEntries?.count) > 5) {
      this.addAlert({
        type: 'rapid_aim_entries',
        severity: 'info',
        message: `${recentAimEntries?.count} tokens entered AIM in last 10 minutes`,
      });
    }
    
    // Check for stuck AIM tokens
    const stuckAim = await db('tokens')
      .where('category', 'AIM')
      .where('category_updated_at', '<', new Date(Date.now() - 30 * 60 * 1000))
      .count('* as count')
      .first();
    
    if (Number(stuckAim?.count) > 0) {
      this.addAlert({
        type: 'stuck_aim_tokens',
        severity: 'warning',
        message: `${stuckAim?.count} tokens stuck in AIM for 30+ minutes`,
      });
    }
    
    // Check buy signal success rate
    const stats = await buySignalService.getStats();
    if (stats.passRate && parseFloat(stats.passRate) < 10) {
      this.addAlert({
        type: 'low_buy_signal_rate',
        severity: 'warning',
        message: `Buy signal pass rate only ${stats.passRate}`,
      });
    }
  }
  
  private addAlert(alert: Omit<Alert, 'timestamp'>): void {
    const fullAlert: Alert = {
      ...alert,
      timestamp: new Date(),
    };
    
    this.alerts.push(fullAlert);
    this.emit('alert', fullAlert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
    
    // Log based on severity
    if (alert.severity === 'critical') {
      logger.error(`ALERT: ${alert.message}`, alert.data);
    } else if (alert.severity === 'warning') {
      logger.warn(`ALERT: ${alert.message}`, alert.data);
    } else {
      logger.info(`ALERT: ${alert.message}`, alert.data);
    }
  }
  
  getRecentAlerts(minutes: number = 60): Alert[] {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    return this.alerts.filter(a => a.timestamp > since);
  }
}

export const alertManager = new AlertManager();

// Start alert checking
setInterval(() => alertManager.checkAlerts(), 60000);
