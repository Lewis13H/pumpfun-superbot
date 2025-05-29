// src/api/settings.ts - Settings endpoints
import { Router } from 'express';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const settingsPath = path.join(process.cwd(), 'config', 'user-settings.json');

const defaultSettings = {
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

router.get('/', async (req, res) => {
  try {
    let settings = defaultSettings;
    
    try {
      const savedSettings = await fs.readFile(settingsPath, 'utf-8');
      settings = { ...defaultSettings, ...JSON.parse(savedSettings) };
    } catch (error) {
      logger.info('No saved settings found, using defaults');
    }

    res.json(settings);
  } catch (error) {
    logger.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const newSettings = req.body;

    // Basic validation
    if (!newSettings.discovery || !newSettings.api || !newSettings.analysis || !newSettings.notifications) {
      return res.status(400).json({ error: 'Invalid settings format' });
    }

    // Ensure config directory exists
    const configDir = path.dirname(settingsPath);
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }

    // Save settings
    await fs.writeFile(
      settingsPath,
      JSON.stringify(newSettings, null, 2),
      'utf-8'
    );

    logger.info('Settings updated successfully');
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    logger.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;