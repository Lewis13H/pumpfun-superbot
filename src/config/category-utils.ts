import { TokenCategory, categoryConfig } from './category-config';

/**
 * Determine category based on market cap
 */
export function getCategoryFromMarketCap(marketCap: number): TokenCategory {
  if (marketCap <= 0) return 'ARCHIVE';
  
  const { thresholds } = categoryConfig;
  
  if (marketCap < thresholds.LOW_MAX) return 'LOW';
  if (marketCap < thresholds.MEDIUM_MAX) return 'MEDIUM';
  if (marketCap < thresholds.HIGH_MAX) return 'HIGH';
  if (marketCap <= thresholds.AIM_MAX) return 'AIM';
  
  // Over AIM_MAX, stays in AIM but might not get buy signals
  return 'AIM';
}

/**
 * Get display name for category
 */
export function getCategoryDisplayName(category: TokenCategory): string {
  const names: Record<TokenCategory, string> = {
    NEW: 'New Discovery',
    LOW: 'Low Priority',
    MEDIUM: 'Medium Priority',
    HIGH: 'High Priority',
    AIM: 'Buy Zone',
    ARCHIVE: 'Archived',
    BIN: 'Dead',
    COMPLETE: 'Completed',
  };
  return names[category] || category;
}

/**
 * Get category color for UI
 */
export function getCategoryColor(category: TokenCategory): string {
  const colors: Record<TokenCategory, string> = {
    NEW: '#9CA3AF',      // Gray
    LOW: '#60A5FA',      // Light Blue
    MEDIUM: '#FBBF24',   // Yellow
    HIGH: '#FB923C',     // Orange
    AIM: '#34D399',      // Green
    ARCHIVE: '#6B7280',  // Dark Gray
    BIN: '#374151',      // Darker Gray
    COMPLETE: '#10B981', // Green      // Darker Gray
  };
  return colors[category] || '#9CA3AF';
}

/**
 * Check if category allows trading
 */
export function canTrade(category: TokenCategory): boolean {
  return category === 'AIM';
}

/**
 * Check if category is terminal
 */
export function isTerminalCategory(category: TokenCategory): boolean {
  return category === 'BIN';
}

/**
 * Get valid transitions from a category
 */
export function getValidTransitions(
  fromCategory: TokenCategory, 
  currentMarketCap: number
): TokenCategory[] {
  // Market cap determines most transitions
  const marketCapCategory = getCategoryFromMarketCap(currentMarketCap);
  
  switch (fromCategory) {
    case 'NEW':
      return ['LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE'];
    
    case 'LOW':
      return ['MEDIUM', 'HIGH', 'AIM', 'ARCHIVE'];
    
    case 'MEDIUM':
      return ['LOW', 'HIGH', 'AIM', 'ARCHIVE'];
    
    case 'HIGH':
      return ['MEDIUM', 'LOW', 'AIM', 'ARCHIVE'];
    
    case 'AIM':
      return ['HIGH', 'MEDIUM', 'LOW', 'ARCHIVE'];
    
    case 'ARCHIVE':
      return ['LOW', 'MEDIUM', 'HIGH', 'AIM', 'BIN'];
    
    case 'BIN':
      return []; // Terminal state
    
    default:
      return [];
  }
}


