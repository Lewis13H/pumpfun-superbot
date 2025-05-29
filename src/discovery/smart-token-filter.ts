// src/discovery/smart-token-filter.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TokenDiscovery } from './base-monitor';
import { DexScreenerClient } from '../api/dexscreener-client';

export interface FilterCriteria {
  minMarketCap?: number;
  minLiquidity?: number;
  minVolume24h?: number;
  minHolders?: number;
  requireLiquidity?: boolean;
  requireName?: boolean; // Skip tokens without proper names
}

export class SmartTokenFilter extends EventEmitter {
  private dexScreener: DexScreenerClient;
  private filters: Map<string, FilterCriteria> = new Map();

  constructor() {
    super();
    this.dexScreener = new DexScreenerClient();
    this.setupDefaultFilters();
  }

  private setupDefaultFilters() {
    // Different filter presets - Updated to match user requirements
    this.filters.set('strict', {
      minMarketCap: 1000, // MC > $1K
      minLiquidity: 500,  // Liquidity > $500
      requireLiquidity: true,
      requireName: true
    });

    this.filters.set('moderate', {
      minMarketCap: 100,  // MC > $100
      minLiquidity: 100,  // Liquidity > $100 (default)
      requireLiquidity: true,
      requireName: true
    });

    this.filters.set('graduation_candidate', {
      minMarketCap: 45000, // MC > $45K
      minLiquidity: 1000,  // Reasonable liquidity requirement
      requireLiquidity: true
    });

    this.filters.set('new_with_traction', {
      minLiquidity: 50,    // Any liquidity > $50
      requireLiquidity: true,
      requireName: false   // Allow tokens without proper names for very new tokens
    });
  }

  async shouldProcessToken(token: TokenDiscovery, filterName: string = 'moderate'): Promise<boolean> {
    const criteria = this.filters.get(filterName) || this.filters.get('moderate')!;

    // Quick checks first - More lenient name checking
    if (criteria.requireName && (!token.name || 
        token.name === 'Unknown Token' || 
        token.name === 'UNKNOWN' || 
        token.name.trim() === '' ||
        (token.name.includes('PUMP-NEW') && filterName !== 'new_with_traction'))) {
      logger.debug(`Skipping token without proper name: ${token.address} (name: ${token.name})`);
      return false;
    }

    // For new_with_traction filter, we're more lenient about names but still want some basic data
    if (filterName === 'new_with_traction' && (!token.address || token.address.length < 32)) {
      logger.debug(`Skipping token with invalid address: ${token.address}`);
      return false;
    }

    // Check on DexScreener for market data
    try {
      const pairs = await this.dexScreener.getTokenPairs(token.address);
      
      if (!pairs || pairs.length === 0) {
        // For new_with_traction, allow tokens without trading pairs if they're very new
        if (filterName === 'new_with_traction') {
          const tokenAge = Date.now() - token.createdAt.getTime();
          if (tokenAge < 5 * 60 * 1000) { // Less than 5 minutes old
            logger.info(`Allowing very new token without trading pairs: ${token.symbol} (${Math.round(tokenAge / 1000)}s old)`);
            
            // Emit event with minimal data
            this.emit('tokenPassedFilter', {
              token,
              marketData: {
                marketCap: 0,
                liquidity: 0,
                volume24h: 0,
                price: 0
              },
              filterName
            });
            
            return true;
          }
        }
        
        logger.debug(`No trading pairs found for ${token.symbol}`);
        return false;
      }

      const primaryPair = pairs[0];
      
      // Get basic market data from DexScreener
      let marketCap = parseFloat(primaryPair.fdv?.toString() || '0');
      let liquidity = parseFloat(primaryPair.liquidity?.toString() || '0');
      let volume24h = parseFloat(primaryPair.volume24h?.toString() || '0');
      const price = primaryPair.priceUsd;

      // For PumpFun tokens, calculate liquidity from SOL reserves if DexScreener reports zero
      if (token.platform === 'pumpfun' && liquidity === 0) {
        // Check if we have PumpFun-specific data in token metadata
        const pumpfunData = (token.metadata as any)?.pumpfunData || (token as any).pumpfunData;
        
        if (pumpfunData?.real_sol_reserves) {
          const solPrice = 240; // Approximate SOL price - could be made dynamic
          const calculatedLiquidity = pumpfunData.real_sol_reserves * solPrice;
          liquidity = calculatedLiquidity;
          logger.info(`📊 PumpFun liquidity calculated from ${pumpfunData.real_sol_reserves} SOL = $${calculatedLiquidity.toFixed(2)}`);
        } else {
          // Fallback: estimate based on market cap for PumpFun bonding curve
          if (marketCap > 0) {
            // PumpFun bonding curve typically has ~3-5% of market cap as SOL reserves
            const estimatedSolReserves = (marketCap * 0.04) / 240; // 4% of MC in SOL
            liquidity = estimatedSolReserves * 240;
            logger.info(`📊 PumpFun liquidity estimated from MC: $${liquidity.toFixed(2)} (${estimatedSolReserves.toFixed(2)} SOL)`);
          }
        }
      }

      // Check liquidity requirement (now using calculated PumpFun liquidity if available)
      if (criteria.requireLiquidity && liquidity === 0) {
        logger.debug(`No liquidity for ${token.symbol} (including PumpFun calculation)`);
        return false;
      }

      // Check thresholds
      if (criteria.minMarketCap && marketCap < criteria.minMarketCap) {
        logger.debug(`Market cap too low for ${token.symbol}: $${marketCap} < $${criteria.minMarketCap}`);
        return false;
      }

      if (criteria.minLiquidity && liquidity < criteria.minLiquidity) {
        logger.debug(`Liquidity too low for ${token.symbol}: $${liquidity} < $${criteria.minLiquidity}`);
        return false;
      }

      if (criteria.minVolume24h && volume24h < criteria.minVolume24h) {
        logger.debug(`Volume too low for ${token.symbol}: $${volume24h} < $${criteria.minVolume24h}`);
        return false;
      }

      // Token passes all filters
      logger.info(`✓ Token ${token.symbol} passes ${filterName} filter: MC=$${marketCap}, Liq=$${liquidity}${token.platform === 'pumpfun' ? ' (PumpFun calculated)' : ''}`);
      
      // Emit event with market data (including calculated liquidity)
      this.emit('tokenPassedFilter', {
        token,
        marketData: {
          marketCap,
          liquidity,
          volume24h,
          price
        },
        filterName
      });

      return true;

    } catch (error) {
      logger.error(`Error checking token ${token.address}:`, error);
      return false;
    }
  }

  addCustomFilter(name: string, criteria: FilterCriteria) {
    this.filters.set(name, criteria);
    logger.info(`Added custom filter: ${name}`, criteria);
  }

  getFilters(): Map<string, FilterCriteria> {
    return this.filters;
  }
}