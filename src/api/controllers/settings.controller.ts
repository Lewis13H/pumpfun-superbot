// src/api/controllers/settings.controller.ts
import { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import fs from 'fs/promises';
import path from 'path';

export class SettingsController {
  private settingsPath = path.join(process.cwd(), 'config', 'user-settings.json');
  
  private defaultSettings = {
    discovery: {
      minMarketCap: 5000,
      maxMarketCap: 1000000,
      minLiquidity: 10000,
      minHolders: 50,
      maxTokenAge: 48,
      excludeHoneypots: true
    },
    api: {
      dailyBudget: 25,
      premiumLimit: 250,
      standardLimit: 750,
      basicLimit: 1500,
      minimalLimit: 5000,
      autoOptimize: true
    },
    analysis: {
      defaultTier: 'STANDARD' as const,
      premiumThreshold: 0.7,
      standardThreshold: 0.5,
      basicThreshold: 0.3
    },
    notifications: {
      enabled: true,
      buySignals: true,
      sellSignals: true,
      highConfidenceOnly: false,
      minConfidence: 0.65,
      apiAlerts: true,
      errorAlerts: true
    }
  };

  async getSettings(req: Request, res: Response) {
    try {
      // Try to load saved settings
      let settings = this.defaultSettings;
      
      try {
        const savedSettings = await fs.readFile(this.settingsPath, 'utf-8');
        settings = { ...this.defaultSettings, ...JSON.parse(savedSettings) };
      } catch (error) {
        // File doesn't exist or can't be read, use defaults
        logger.info('No saved settings found or file error, using defaults:', error);
      }

      res.json(settings);
    } catch (error) {
      logger.error('Error fetching settings:', error);
      // Return default settings instead of failing
      res.json(this.defaultSettings);
    }
  }

  async updateSettings(req: Request, res: Response) {
    try {
      const newSettings = req.body;

      // Validate settings structure
      if (!this.validateSettings(newSettings)) {
        return res.status(400).json({ error: 'Invalid settings format' });
      }

      // Ensure config directory exists
      const configDir = path.dirname(this.settingsPath);
      try {
        await fs.access(configDir);
      } catch {
        await fs.mkdir(configDir, { recursive: true });
      }

      // Save settings
      await fs.writeFile(
        this.settingsPath,
        JSON.stringify(newSettings, null, 2),
        'utf-8'
      );

      logger.info('Settings updated successfully');
      res.json({ message: 'Settings updated successfully', settings: newSettings });
    } catch (error) {
      logger.error('Error updating settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }

  private validateSettings(settings: any): boolean {
    // Basic validation - check required fields exist
    return (
      settings.discovery &&
      settings.api &&
      settings.analysis &&
      settings.notifications &&
      typeof settings.discovery.minMarketCap === 'number' &&
      typeof settings.api.dailyBudget === 'number' &&
      typeof settings.analysis.defaultTier === 'string' &&
      typeof settings.notifications.enabled === 'boolean'
    );
  }
}
