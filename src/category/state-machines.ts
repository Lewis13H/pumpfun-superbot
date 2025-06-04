import { createMachine, assign, StateMachine } from 'xstate';
import { TokenCategory, categoryConfig } from '../config/category-config';
import { logger } from '../utils/logger';

// Context for token state machine
export interface TokenContext {
  tokenAddress: string;
  currentMarketCap: number;
  categoryStartTime: number;
  scanCount: number;
  lastScanTime?: number;
  metadata?: Record<string, any>;
}

// Events that can trigger transitions
export type TokenEvent = 
  | { type: 'UPDATE_MARKET_CAP'; marketCap: number }
  | { type: 'SCAN_COMPLETE' }
  | { type: 'TIMEOUT' }
  | { type: 'MANUAL_OVERRIDE'; category: TokenCategory; reason: string }
  | { type: 'BUY_EXECUTED' }
  | { type: 'FORCE_ARCHIVE'; reason: string };

// Create the state machine factory
export function createTokenStateMachine(tokenAddress: string): StateMachine<TokenContext, any, TokenEvent> {
  const { thresholds, scanIntervals } = categoryConfig;
  
  return createMachine<TokenContext, TokenEvent>({
    id: `token-${tokenAddress}`,
    initial: 'NEW',
    context: {
      tokenAddress,
      currentMarketCap: 0,
      categoryStartTime: Date.now(),
      scanCount: 0,
    },
    
    states: {
      NEW: {
        entry: 'logCategoryEntry',
        exit: 'logCategoryExit',
        
        after: {
          [scanIntervals.NEW.duration * 1000]: {
            target: 'ARCHIVE',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
             target: 'ARCHIVE',
             cond: 'isZeroMarketCap',
             actions: 'updateMarketCap',
            },
            {
              target: 'LOW',
              cond: 'isLowMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'MEDIUM',
              cond: 'isMediumMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'HIGH',
              cond: 'isHighMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'AIM',
              cond: 'isAimMarketCap',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          SCAN_COMPLETE: {
            actions: 'incrementScanCount',
          },
          
          FORCE_ARCHIVE: {
            target: 'ARCHIVE',
          },
        },
      },
      
      LOW: {
        entry: 'logCategoryEntry',
        exit: 'logCategoryExit',
        
        after: {
          [scanIntervals.LOW.duration * 1000]: {
            target: 'ARCHIVE',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
              target: 'MEDIUM',
              cond: 'isMediumMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'HIGH',
              cond: 'isHighMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'AIM',
              cond: 'isAimMarketCap',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          SCAN_COMPLETE: [
            {
              target: 'ARCHIVE',
              cond: 'exceededMaxScans',
              actions: 'incrementScanCount',
            },
            {
              actions: 'incrementScanCount',
            },
          ],
          
          FORCE_ARCHIVE: {
            target: 'ARCHIVE',
          },
        },
      },
      
      MEDIUM: {
        entry: 'logCategoryEntry',
        exit: 'logCategoryExit',
        
        after: {
          [scanIntervals.MEDIUM.duration * 1000]: {
            target: 'LOW',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
              target: 'LOW',
              cond: 'isLowMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'HIGH',
              cond: 'isHighMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'AIM',
              cond: 'isAimMarketCap',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          SCAN_COMPLETE: [
            {
              target: 'LOW',
              cond: 'exceededMaxScans',
              actions: 'incrementScanCount',
            },
            {
              actions: 'incrementScanCount',
            },
          ],
        },
      },
      
      HIGH: {
        entry: 'logCategoryEntry',
        exit: 'logCategoryExit',
        
        after: {
          [scanIntervals.HIGH.duration * 1000]: {
            target: 'MEDIUM',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
              target: 'MEDIUM',
              cond: 'isMediumMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'LOW',
              cond: 'isLowMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'AIM',
              cond: 'isAimMarketCap',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          SCAN_COMPLETE: [
            {
              target: 'MEDIUM',
              cond: 'exceededMaxScans',
              actions: 'incrementScanCount',
            },
            {
              actions: 'incrementScanCount',
            },
          ],
        },
      },
      
      AIM: {
        entry: ['logCategoryEntry', 'notifyAimEntry'],
        exit: 'logCategoryExit',
        
        after: {
          [scanIntervals.AIM.duration * 1000]: {
            target: 'HIGH',
            cond: 'isHighMarketCap',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
              target: 'HIGH',
              cond: 'isHighMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'MEDIUM',
              cond: 'isMediumMarketCap',
              actions: 'updateMarketCap',
            },
            {
              target: 'LOW',
              cond: 'isLowMarketCap',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          BUY_EXECUTED: {
            target: 'COMPLETE',
            actions: 'logBuyExecution',
          },
          
          SCAN_COMPLETE: [
            {
              target: 'HIGH',
              cond: 'exceededMaxScans',
              actions: 'incrementScanCount',
            },
            {
              actions: 'incrementScanCount',
            },
          ],
        },
      },
      
      ARCHIVE: {
        entry: 'logCategoryEntry',
        
        after: {
          [scanIntervals.ARCHIVE.duration * 1000]: {
            target: 'BIN',
            actions: 'logTimeout',
          },
        },
        
        on: {
          UPDATE_MARKET_CAP: [
            {
              target: 'LOW',
              cond: 'isRecovering',
              actions: 'updateMarketCap',
            },
            {
              actions: 'updateMarketCap',
            },
          ],
          
          SCAN_COMPLETE: [
            {
              target: 'BIN',
              cond: 'exceededMaxScans',
              actions: 'incrementScanCount',
            },
            {
              actions: 'incrementScanCount',
            },
          ],
        },
      },
      
      BIN: {
        type: 'final',
        entry: 'logCategoryEntry',
      },
      
      COMPLETE: {
        type: 'final',
        entry: 'logCategoryEntry',
      },
    },
  }, {
    guards: {
      isZeroMarketCap: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap <= 0;
      },
      
      isLowMarketCap: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap > 0 && event.marketCap < thresholds.LOW_MAX;
      },
      
      isMediumMarketCap: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap >= thresholds.LOW_MAX && 
               event.marketCap < thresholds.MEDIUM_MAX;
      },
      
      isHighMarketCap: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap >= thresholds.MEDIUM_MAX && 
               event.marketCap < thresholds.HIGH_MAX;
      },
      
      isAimMarketCap: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap >= thresholds.AIM_MIN && 
               event.marketCap <= thresholds.AIM_MAX;
      },
      
      isRecovering: (context, event) => {
        if (event.type !== 'UPDATE_MARKET_CAP') return false;
        return event.marketCap >= thresholds.LOW_MAX;
      },
      
      exceededMaxScans: (context) => {
        const state = context as any;
        const category = state.value as TokenCategory;
        const maxScans = scanIntervals[category]?.maxScans || Infinity;
        return context.scanCount >= maxScans;
      },
    },
    
    actions: {
      updateMarketCap: assign({
        currentMarketCap: (_, event) => 
          event.type === 'UPDATE_MARKET_CAP' ? event.marketCap : 0,
        lastScanTime: () => Date.now(),
      }),
      
      incrementScanCount: assign({
        scanCount: (context) => context.scanCount + 1,
        lastScanTime: () => Date.now(),
      }),
      
      logCategoryEntry: (context, event, { state }) => {
        logger.info(`Token ${context.tokenAddress} entered ${state.value}`);
      },
      
      logCategoryExit: (context, event, { state }) => {
        logger.info(`Token ${context.tokenAddress} exiting ${state.value}`);
      },
      
      logTimeout: (context) => {
        logger.info(`Token ${context.tokenAddress} timed out`);
      },
      
      notifyAimEntry: (context) => {
        logger.info(`🎯 Token ${context.tokenAddress} entered AIM zone!`);
      },
      
      logBuyExecution: (context) => {
        logger.info(`💰 Buy executed for token ${context.tokenAddress}`);
      },
    },
  });
}

// Type guard functions
export function isTokenEvent(event: any): event is TokenEvent {
  return event && typeof event.type === 'string';
}

export function isMarketCapEvent(event: TokenEvent): event is { type: 'UPDATE_MARKET_CAP'; marketCap: number } {
  return event.type === 'UPDATE_MARKET_CAP';
}
