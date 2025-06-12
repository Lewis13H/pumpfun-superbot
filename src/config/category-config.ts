// Updated category-config.ts

import { config as dotenv } from 'dotenv';
import { logger } from '../utils/logger2';

dotenv();

// Category type definition - Added GRADUATED
export type TokenCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'AIM' | 'GRADUATED' | 'ARCHIVE' | 'BIN' | 'COMPLETE';

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
    MIN_MARKET_CAP: number;  // New: Minimum $8k to save
    LOW_MIN: number;
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
  archiveSettings: {
    belowThresholdHours: number; // Hours below $8k before archiving
    checkIntervalMinutes: number; // How often to check for tokens to archive
  };
}

// Load from environment with defaults
function loadConfig(): CategoryConfig {
  return {
    thresholds: {
      MIN_MARKET_CAP: parseInt(process.env.MIN_MARKET_CAP || '8000'),  // $8k minimum
      LOW_MIN: parseInt(process.env.CATEGORY_LOW_MIN || '8000'),      // $8k
      LOW_MAX: parseInt(process.env.CATEGORY_LOW_MAX || '15000'),     // $15k
      MEDIUM_MAX: parseInt(process.env.CATEGORY_MEDIUM_MAX || '25000'), // $25k
      HIGH_MAX: parseInt(process.env.CATEGORY_HIGH_MAX || '35000'),    // $35k
      AIM_MIN: parseInt(process.env.CATEGORY_AIM_MIN || '35000'),      // $35k
      AIM_MAX: parseInt(process.env.CATEGORY_AIM_MAX || '105000'),     // $105k
    },
    scanIntervals: {
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
      GRADUATED: {
        interval: parseInt(process.env.SCAN_INTERVAL_GRADUATED || '3600'), // 1 hour
        duration: parseInt(process.env.SCAN_DURATION_GRADUATED || '86400'), // 24 hours
        maxScans: parseInt(process.env.SCAN_MAX_GRADUATED || '24'),
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
    archiveSettings: {
      belowThresholdHours: parseInt(process.env.ARCHIVE_BELOW_THRESHOLD_HOURS || '48'),
      checkIntervalMinutes: parseInt(process.env.ARCHIVE_CHECK_INTERVAL_MINUTES || '60'),
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

// Updated category utilities
export function getCategoryFromMarketCap(marketCap: number): TokenCategory | null {
  if (marketCap < categoryConfig.thresholds.MIN_MARKET_CAP) return null; // Below $8k
  
  const { thresholds } = categoryConfig;
  
  if (marketCap < thresholds.LOW_MAX) return 'LOW';
  if (marketCap < thresholds.MEDIUM_MAX) return 'MEDIUM';
  if (marketCap < thresholds.HIGH_MAX) return 'HIGH';
  if (marketCap <= thresholds.AIM_MAX) return 'AIM';
  
  return 'GRADUATED';
}

// Get display name for category
export function getCategoryDisplayName(category: TokenCategory): string {
  const names: Record<TokenCategory, string> = {
    LOW: 'Low Priority ($8k-$15k)',
    MEDIUM: 'Medium Priority ($15k-$25k)',
    HIGH: 'High Priority ($25k-$35k)',
    AIM: 'Buy Zone ($35k-$105k)',
    GRADUATED: 'Graduated (>$105k)',
    ARCHIVE: 'Archived',
    BIN: 'Dead',
    COMPLETE: 'Completed',
  };
  return names[category] || category;
}

// Get category color for UI
export function getCategoryColor(category: TokenCategory): string {
  const colors: Record<TokenCategory, string> = {
    LOW: '#60A5FA',      // Light Blue
    MEDIUM: '#FBBF24',   // Yellow
    HIGH: '#FB923C',     // Orange
    AIM: '#34D399',      // Green
    GRADUATED: '#8B5CF6', // Purple
    ARCHIVE: '#6B7280',  // Dark Gray
    BIN: '#374151',      // Darker Gray
    COMPLETE: '#10B981', // Emerald
  };
  return colors[category] || '#9CA3AF';
}

// Check if category allows trading
export function canTrade(category: TokenCategory): boolean {
  return category === 'AIM';
}

// Check if category is terminal
export function isTerminalCategory(category: TokenCategory): boolean {
  return category === 'BIN' || category === 'COMPLETE';
}

// Get valid transitions from a category
export function getValidTransitions(
  fromCategory: TokenCategory,
  currentMarketCap: number
): TokenCategory[] {
  // Market cap determines most transitions
  const marketCapCategory = getCategoryFromMarketCap(currentMarketCap);
  
  switch (fromCategory) {
    case 'LOW':
      return ['MEDIUM', 'HIGH', 'AIM', 'GRADUATED', 'ARCHIVE'];
    
    case 'MEDIUM':
      return ['LOW', 'HIGH', 'AIM', 'GRADUATED', 'ARCHIVE'];
    
    case 'HIGH':
      return ['MEDIUM', 'LOW', 'AIM', 'GRADUATED', 'ARCHIVE'];
    
    case 'AIM':
      return ['HIGH', 'MEDIUM', 'LOW', 'GRADUATED', 'ARCHIVE'];
    
    case 'GRADUATED':
      return ['AIM', 'HIGH', 'MEDIUM', 'LOW', 'ARCHIVE'];
    
    case 'ARCHIVE':
      return ['LOW', 'MEDIUM', 'HIGH', 'AIM', 'GRADUATED', 'BIN'];
    
    case 'BIN':
      return []; // Terminal state
    
    case 'COMPLETE':
      return []; // Terminal state
    
    default:
      return [];
  }
}

// Log configuration on load
if (validateConfig(categoryConfig)) {
  logger.info('Category configuration loaded successfully');
  logger.info(`Minimum market cap threshold: $${categoryConfig.thresholds.MIN_MARKET_CAP}`);
  logger.info(`Archive after ${categoryConfig.archiveSettings.belowThresholdHours} hours below threshold`);
} else {
  logger.error('Invalid category configuration - using defaults');
}