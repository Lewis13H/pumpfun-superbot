// src/constants/pumpfun-constants.ts

/**
 * Pump.fun Bonding Curve Constants
 * CORRECTED based on documentation and reverse engineering
 * 
 * IMPORTANT: Pump.fun uses an EXPONENTIAL curve, not linear!
 * Formula: y = 0.6015 * e^(0.00003606 * x)
 */

export const PUMP_FUN_CONSTANTS = {
  // Token Distribution
  TOTAL_SUPPLY: 1_000_000_000,          // 1B tokens total
  BONDING_CURVE_SUPPLY: 800_000_000,    // 800M sold on curve
  LIQUIDITY_POOL_SUPPLY: 200_000_000,   // 200M reserved for Raydium
  TOKEN_DECIMALS: 6,                    // Pump.fun uses 6 decimals
  
  // Market Cap Progression
  INITIAL_MARKET_CAP_USD: 4000,         // $4k starting market cap
  GRADUATION_MARKET_CAP_USD: 69000,     // $69k graduation market cap
  
  // Fundraising Amount
  TOTAL_RAISED_USD: 12000,              // $12k total raised (NOT $69k!)
  EXPECTED_SOL_AT_GRADUATION: 73,       // ~73 SOL (depends on SOL price)
  
  // Exponential Curve Parameters
  CURVE_COEFFICIENT_A: 0.6015,          // Coefficient in y = A * e^(B*x)
  CURVE_COEFFICIENT_B: 0.00003606,      // Exponent coefficient
  
  // Prices
  INITIAL_PRICE_USD: 0.000004,          // ~$0.000004 starting price
  FINAL_PRICE_USD: 0.000069,            // ~$0.000069 at graduation
  DEX_INITIAL_PRICE_USD: 0.00006,       // $12k/200M = $0.00006
  
  // Fees and Rewards
  TRADING_FEE_PERCENT: 0.01,            // 1% fee on all trades
  GRADUATION_FEE_USD: 500,              // ~$500 graduation fee
  CREATOR_REWARD_SOL: 0.5,              // Creator gets 0.5 SOL on graduation
  
  // Program IDs
  PUMP_FUN_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMP_FUN_FEE: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
  PUMP_FUN_EVENT_AUTHORITY: 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1',
  
  // WebSocket Configuration
  PUMP_FUN_WS_URL: 'wss://pumpportal.fun/api/data',
  
  // Monitoring Thresholds
  MIN_MARKET_CAP_TRACK: 10000,          // Start tracking at $10K market cap
  GRADUATION_ALERT_THRESHOLDS: {
    APPROACHING: 0.70,                  // 70% progress (~$48k market cap)
    IMMINENT: 0.90,                     // 90% progress (~$62k market cap)
  },
  
  // DEPRECATED - These were for the incorrect linear model
  SLOPE_K: null,                        // Not used in exponential curve
  STARTING_PRICE_SOL: null,             // Use USD prices instead
  FINAL_PRICE_SOL: null,                // Use USD prices instead
} as const;

// Type exports for better TypeScript support
export type PumpFunConstants = typeof PUMP_FUN_CONSTANTS;
