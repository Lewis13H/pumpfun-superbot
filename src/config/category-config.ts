import { config as dotenv } from 'dotenv';
import { logger } from '../utils/logger';

dotenv();

// Category type definition
export type TokenCategory = 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'AIM' | 'ARCHIVE' | 'BIN' | 'COMPLETE';

// Scan interval configuration
export interface ScanConfig {
  interval: number;  // seconds
  duration: number;  // seconds
  maxScans: number;  // maximum scans before timeout
}

// Buy signal criteria
export interface BuyCriteria {
  marketCap: { min: number; max: number };
  liquidity: { min: number };
  holders: { min: number };
  top10Concentration: { max: number };
  solsniffer: { min: number; blacklist: number[] };
}

// Position limits
export interface PositionLimits {
  solsniffer: Array<{ min: number; max: number; limit: number }>;
  holders: Array<{ min: number; max: number; limit: number }>;
  concentration: { threshold: number; limit: number };
}

// Main configuration interface
export interface CategoryConfig {
  thresholds: {
    LOW_MAX: number;
    MEDIUM_MAX: number;
    HIGH_MAX: number;
    AIM_MIN: number;
    AIM_MAX: number;
  };
  scanIntervals: Record<TokenCategory, ScanConfig>;
  buySignalCriteria: BuyCriteria;
  positionLimits: PositionLimits;
  apiUsage: {
    useSnifferInAimOnly: boolean;
    basicApiList: string[];
    fullApiList: string[];
  };
}

// Load from environment with defaults
function loadConfig(): CategoryConfig {
  return {
    thresholds: {
      LOW_MAX: parseInt(process.env.CATEGORY_LOW_MAX || '8000'),
      MEDIUM_MAX: parseInt(process.env.CATEGORY_MEDIUM_MAX || '19000'),
      HIGH_MAX: parseInt(process.env.CATEGORY_HIGH_MAX || '35000'),
      AIM_MIN: parseInt(process.env.CATEGORY_AIM_MIN || '35000'),
      AIM_MAX: parseInt(process.env.CATEGORY_AIM_MAX || '105000'),
    },
    scanIntervals: {
      NEW: {
        interval: parseInt(process.env.SCAN_INTERVAL_NEW || '300'),
        duration: parseInt(process.env.SCAN_DURATION_NEW || '1800'),
        maxScans: parseInt(process.env.SCAN_MAX_NEW || '6'),
      },
      LOW: {
        interval: parseInt(process.env.SCAN_INTERVAL_LOW || '1200'),
        duration: parseInt(process.env.SCAN_DURATION_LOW || '10800'),
        maxScans: parseInt(process.env.SCAN_MAX_LOW || '9'),
      },
      MEDIUM: {
        interval: parseInt(process.env.SCAN_INTERVAL_MEDIUM || '600'),
        duration: parseInt(process.env.SCAN_DURATION_MEDIUM || '3600'),
        maxScans: parseInt(process.env.SCAN_MAX_MEDIUM || '6'),
      },
      HIGH: {
        interval: parseInt(process.env.SCAN_INTERVAL_HIGH || '60'),
        duration: parseInt(process.env.SCAN_DURATION_HIGH || '3600'),
        maxScans: parseInt(process.env.SCAN_MAX_HIGH || '60'),
      },
      AIM: {
        interval: parseInt(process.env.SCAN_INTERVAL_AIM || '10'),
        duration: parseInt(process.env.SCAN_DURATION_AIM || '600'),
        maxScans: parseInt(process.env.SCAN_MAX_AIM || '60'),
      },
      ARCHIVE: {
        interval: parseInt(process.env.SCAN_INTERVAL_ARCHIVE || '43200'),
        duration: parseInt(process.env.SCAN_DURATION_ARCHIVE || '259200'),
        maxScans: parseInt(process.env.SCAN_MAX_ARCHIVE || '6'),
      },
      BIN: {
        interval: 0,
        duration: 0,
        maxScans: 0,
      },
        COMPLETE: {
        interval: 0,
        duration: 0,
        maxScans: 0,
      },
    },
    buySignalCriteria: {
      marketCap: {
        min: parseInt(process.env.BUY_MIN_MARKET_CAP || '35000'),
        max: parseInt(process.env.BUY_MAX_MARKET_CAP || '105000'),
      },
      liquidity: {
        min: parseInt(process.env.BUY_MIN_LIQUIDITY || '7500'),
      },
      holders: {
        min: parseInt(process.env.BUY_MIN_HOLDERS || '50'),
      },
      top10Concentration: {
        max: parseInt(process.env.BUY_MAX_TOP10_CONCENTRATION || '25'),
      },
      solsniffer: {
        min: parseInt(process.env.BUY_MIN_SOLSNIFFER || '60'),
        blacklist: (process.env.BUY_SOLSNIFFER_BLACKLIST || '90').split(',').map(Number),
      },
    },
    positionLimits: {
      solsniffer: [
        { min: 60, max: 70, limit: 0.1 },
        { min: 70, max: 90, limit: 0.25 },
        { min: 91, max: 100, limit: 1.0 },
      ],
      holders: [
        { min: 50, max: 150, limit: 0.1 },
        { min: 150, max: 500, limit: 0.25 },
        { min: 500, max: Infinity, limit: 1.0 },
      ],
      concentration: {
        threshold: 25,
        limit: 0.1,
      },
    },
    apiUsage: {
      useSnifferInAimOnly: true,
      basicApiList: ['dexscreener', 'birdeye', 'helius'],
      fullApiList: ['dexscreener', 'birdeye', 'helius', 'solsniffer', 'moralis'],
    },
  };
}

// Export singleton config
export const categoryConfig = loadConfig();

// Validation function
export function validateConfig(config: CategoryConfig): boolean {
  // Validate thresholds are in order
  if (config.thresholds.LOW_MAX >= config.thresholds.MEDIUM_MAX) {
    logger.error('LOW_MAX must be less than MEDIUM_MAX');
    return false;
  }
  
  if (config.thresholds.MEDIUM_MAX >= config.thresholds.HIGH_MAX) {
    logger.error('MEDIUM_MAX must be less than HIGH_MAX');
    return false;
  }
  
  if (config.thresholds.HIGH_MAX !== config.thresholds.AIM_MIN) {
    logger.error('HIGH_MAX must equal AIM_MIN for continuous ranges');
    return false;
  }
  
  // Validate scan configs
  for (const [category, scanConfig] of Object.entries(config.scanIntervals)) {
    if (category === 'BIN' || category === 'COMPLETE') continue;
    
    if (scanConfig.interval <= 0) {
      logger.error(`Invalid interval for ${category}: ${scanConfig.interval}`);
      return false;
    }
    
    if (scanConfig.duration <= scanConfig.interval) {
      logger.error(`Duration must be greater than interval for ${category}`);
      return false;
    }
    
    const expectedScans = Math.floor(scanConfig.duration / scanConfig.interval);
    if (Math.abs(expectedScans - scanConfig.maxScans) > 1) {
      logger.warn(`Scan count mismatch for ${category}: expected ~${expectedScans}, configured ${scanConfig.maxScans}`);
    }
  }
  
  return true;
}

// Hot reload capability
export class ConfigManager {
  private static instance: CategoryConfig = loadConfig();
  private static watchers: Array<(config: CategoryConfig) => void> = [];
  
  static getConfig(): CategoryConfig {
    return this.instance;
  }
  
  static reload(): boolean {
    const newConfig = loadConfig();
    if (validateConfig(newConfig)) {
      this.instance = newConfig;
      this.notifyWatchers();
      logger.info('Configuration reloaded successfully');
      return true;
    }
    return false;
  }
  
  static watch(callback: (config: CategoryConfig) => void): void {
    this.watchers.push(callback);
  }
  
  private static notifyWatchers(): void {
    this.watchers.forEach(callback => callback(this.instance));
  }
}

// Log configuration on load
if (validateConfig(categoryConfig)) {
  logger.info('Category configuration loaded successfully');
} else {
  logger.error('Invalid category configuration - using defaults');
}





