import { db } from '../../database/postgres';
import { logger } from '../../utils/logger';

export class SettingsService {
  private defaultSettings = {
    discovery: {
      minMarketCap: 5000,
      maxTokenAge: 60,
      activeSources: ['pumpfun', 'raydium'],
      discoveryInterval: 5000
    },
    analysis: {
      enhancedSecurity: true,
      smartMoneyTracking: true,
      graduationDetection: true,
      firstBuyerAnalysis: false
    },
    costManagement: {
      dailyBudget: 25,
      tierDistribution: {
        premium: 0.05,
        standard: 0.15,
        basic: 0.30,
        minimal: 0.50
      },
      emergencyMode: true
    }
  };

  async getSettings() {
    try {
      // In a real app, load from database
      // For now, return defaults with current spend
      const currentSpend = await this.getCurrentDailySpend();
      
      return {
        ...this.defaultSettings,
        costManagement: {
          ...this.defaultSettings.costManagement,
          currentSpend
        }
      };
    } catch (error) {
      logger.error('Error getting settings:', error);
      throw error;
    }
  }

  async updateSettings(updates: any) {
    try {
      // In a real app, save to database
      // For now, just log the update
      logger.info('Settings update requested:', updates);
      
      return {
        success: true,
        updated: Object.keys(updates).map(key => 
          Object.keys(updates[key]).map(subKey => `${key}.${subKey}`)
        ).flat()
      };
    } catch (error) {
      logger.error('Error updating settings:', error);
      throw error;
    }
  }

  private async getCurrentDailySpend() {
    // Calculate from your cost tracking
    return 15.42; // Example value
  }
}
