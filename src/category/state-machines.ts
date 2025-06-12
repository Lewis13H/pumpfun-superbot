import { createMachine, assign } from 'xstate';
import { logger } from '../utils/logger';

// Market cap thresholds
export const MARKET_CAP_THRESHOLDS = {
  ARCHIVE: 8000,      // Below $8k
  LOW: 15000,         // $8k-$15k
  MEDIUM: 25000,      // $15k-$25k
  HIGH: 35000,        // $25k-$35k
  AIM: 105000,        // $35k-$105k
  GRADUATED: 105000   // Above $105k
};

// Token context interface
interface TokenContext {
  tokenAddress: string;
  marketCap: number;
  lastUpdate: Date;
  transitionHistory: Array<{
    from: string;
    to: string;
    marketCap: number;
    timestamp: Date;
  }>;
}

// Event types
type TokenEvent = 
  | { type: 'PRICE_UPDATE'; marketCap: number; timestamp: Date }
  | { type: 'FORCE_ARCHIVE' }
  | { type: 'MANUAL_OVERRIDE'; targetState: string };

export function createTokenCategoryMachine(tokenAddress: string) {
  return createMachine<TokenContext, TokenEvent>({
    id: `token-${tokenAddress}`,
    initial: 'LOW',
    context: {
      tokenAddress,
      marketCap: 0,
      lastUpdate: new Date(),
      transitionHistory: []
    },
    states: {
      LOW: {
        entry: 'logStateEntry',
        on: {
          PRICE_UPDATE: [
            { target: 'ARCHIVE', cond: 'shouldArchive', actions: 'updateContext' },
            { target: 'MEDIUM', cond: 'shouldPromoteToMedium', actions: 'updateContext' },
            { actions: 'updateContext' } // Stay in LOW
          ],
          FORCE_ARCHIVE: { target: 'ARCHIVE', actions: 'updateContext' }
        }
      },
      MEDIUM: {
        entry: 'logStateEntry',
        on: {
          PRICE_UPDATE: [
            { target: 'ARCHIVE', cond: 'shouldArchive', actions: 'updateContext' },
            { target: 'LOW', cond: 'shouldDemoteToLow', actions: 'updateContext' },
            { target: 'HIGH', cond: 'shouldPromoteToHigh', actions: 'updateContext' },
            { actions: 'updateContext' } // Stay in MEDIUM
          ],
          FORCE_ARCHIVE: { target: 'ARCHIVE', actions: 'updateContext' }
        }
      },
      HIGH: {
        entry: 'logStateEntry',
        on: {
          PRICE_UPDATE: [
            { target: 'ARCHIVE', cond: 'shouldArchive', actions: 'updateContext' },
            { target: 'MEDIUM', cond: 'shouldDemoteToMedium', actions: 'updateContext' },
            { target: 'AIM', cond: 'shouldPromoteToAim', actions: 'updateContext' },
            { actions: 'updateContext' } // Stay in HIGH
          ],
          FORCE_ARCHIVE: { target: 'ARCHIVE', actions: 'updateContext' }
        }
      },
      AIM: {
        entry: ['logStateEntry', 'notifyAimEntry'],
        on: {
          PRICE_UPDATE: [
            { target: 'ARCHIVE', cond: 'shouldArchive', actions: 'updateContext' },
            { target: 'HIGH', cond: 'shouldDemoteToHigh', actions: 'updateContext' },
            { target: 'GRADUATED', cond: 'shouldGraduate', actions: 'updateContext' },
            { actions: 'updateContext' } // Stay in AIM
          ],
          FORCE_ARCHIVE: { target: 'ARCHIVE', actions: 'updateContext' }
        }
      },
      GRADUATED: {
        entry: ['logStateEntry', 'notifyGraduation'],
        on: {
          PRICE_UPDATE: [
            { target: 'AIM', cond: 'shouldDemoteFromGraduated', actions: 'updateContext' },
            { actions: 'updateContext' } // Stay in GRADUATED
          ]
        }
      },
      ARCHIVE: {
        entry: 'logStateEntry',
        type: 'final'
      }
    }
  }, {
    guards: {
      // Archive conditions
      shouldArchive: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap < MARKET_CAP_THRESHOLDS.ARCHIVE;
      },
      
      // LOW state transitions
      shouldPromoteToMedium: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.LOW && 
               event.marketCap < MARKET_CAP_THRESHOLDS.MEDIUM;
      },
      
      // MEDIUM state transitions
      shouldDemoteToLow: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.ARCHIVE && 
               event.marketCap < MARKET_CAP_THRESHOLDS.LOW;
      },
      shouldPromoteToHigh: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.MEDIUM && 
               event.marketCap < MARKET_CAP_THRESHOLDS.HIGH;
      },
      
      // HIGH state transitions
      shouldDemoteToMedium: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.LOW && 
               event.marketCap < MARKET_CAP_THRESHOLDS.MEDIUM;
      },
      shouldPromoteToAim: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.HIGH && 
               event.marketCap < MARKET_CAP_THRESHOLDS.AIM;
      },
      
      // AIM state transitions
      shouldDemoteToHigh: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.MEDIUM && 
               event.marketCap < MARKET_CAP_THRESHOLDS.HIGH;
      },
      shouldGraduate: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap >= MARKET_CAP_THRESHOLDS.GRADUATED;
      },
      
      // GRADUATED state transitions
      shouldDemoteFromGraduated: (context, event) => {
        if (event.type !== 'PRICE_UPDATE') return false;
        return event.marketCap < MARKET_CAP_THRESHOLDS.GRADUATED && 
               event.marketCap >= MARKET_CAP_THRESHOLDS.HIGH;
      }
    },
    actions: {
      updateContext: assign((context, event) => {
        if (event.type === 'PRICE_UPDATE') {
          return {
            ...context,
            marketCap: event.marketCap,
            lastUpdate: event.timestamp
          };
        }
        return context;
      }),
      
      logStateEntry: (context, event, { state }) => {
        logger.info(`Token ${context.tokenAddress} entered ${state.value} state`);
      },
      
      notifyAimEntry: (context) => {
        logger.info(`🎯 Token ${context.tokenAddress} reached AIM category! Market cap: $${context.marketCap}`);
      },
      
      notifyGraduation: (context) => {
        logger.info(`🎓 Token ${context.tokenAddress} GRADUATED! Market cap: $${context.marketCap}`);
      }
    }
  });
}

// Helper function to determine category from market cap
export function determineCategoryFromMarketCap(marketCap: number): string {
  if (marketCap < MARKET_CAP_THRESHOLDS.ARCHIVE) return 'ARCHIVE';
  if (marketCap < MARKET_CAP_THRESHOLDS.LOW) return 'LOW';
  if (marketCap < MARKET_CAP_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (marketCap < MARKET_CAP_THRESHOLDS.HIGH) return 'HIGH';
  if (marketCap < MARKET_CAP_THRESHOLDS.AIM) return 'AIM';
  return 'GRADUATED';
}

// Valid states for validation
export const VALID_STATES = ['LOW', 'MEDIUM', 'HIGH', 'AIM', 'GRADUATED', 'ARCHIVE'];

// Export types
export type { TokenContext, TokenEvent };