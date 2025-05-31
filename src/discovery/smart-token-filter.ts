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
    // LEGACY FILTERS (keeping for backwards compatibility)
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

    // NEW QUALITY FILTERS
    
    // Quality new tokens with some traction
    this.filters.set('quality_new', {
      minMarketCap: 5000,    // $5K minimum
      minLiquidity: 2000,    // $2K minimum liquidity
      minVolume24h: 1000,    // $1K daily volume
      requireLiquidity: true,
      requireName: true
    });

    // Established tokens with good metrics
    this.filters.set('established', {
      minMarketCap: 20000,   // $20K minimum
      minLiquidity: 5000,    // $5K minimum liquidity
      minVolume24h: 5000,    // $5K daily volume
      requireLiquidity: true,
      requireName: true
    });

    // Near graduation (approaching $69,420)
    this.filters.set('near_graduation', {
      minMarketCap: 50000,   // $50K minimum (72% of graduation)
      minLiquidity: 10000,   // $10K minimum liquidity
      requireLiquidity: true,
      requireName: true
    });

    // High quality only
    this.filters.set('premium', {
      minMarketCap: 30000,   // $30K minimum
      minLiquidity: 10000,   // $10K minimum liquidity
      minVolume24h: 10000,   // $10K daily volume
      requireLiquidity: true,
      requireName: true
    });

    // Accept all for testing (CAUTION: discovers all tokens)
    this.filters.set('accept_all', {
      minMarketCap: 0,
      minLiquidity: 0,
      requireLiquidity: false,
      requireName: false
    });
  }

  async shouldProcessToken(token: TokenDiscovery, filterName: string = 'moderate'): Promise<boolean> {
    // TEMPORARY: Accept all tokens for testing
    if (filterName === 'accept_all') {
      logger.info(`BYPASS: Accepting token ${token.symbol} without checks`);
      this.emit('tokenPassedFilter', {
        token,
        marketData: {
          marketCap: token.metadata?.marketCap || 0,
          liquidity: token.metadata?.liquidity || 0,
          volume24h: 0,
          price: token.metadata?.price || 0
        },
        filterName
      });
      return true;
    }

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

    // Try to get market data from metadata first (for PumpFun tokens)
    let marketCap = 0;
    let liquidity = 0;
    let volume24h = 0;
    let price = 0;

    // Check if we have PumpFun data in metadata
    if (token.platform === 'pumpfun' && token.metadata) {
      const metadata = token.metadata as any;
      
      // Calculate market cap from SOL market cap if available
      if (metadata.marketCapSol) {
        const solPrice = 180; // Approximate SOL price
        marketCap = metadata.marketCapSol * solPrice;
      }
      
      // Calculate liquidity from virtual reserves
      if (metadata.virtualSolReserves) {
        const solPrice = 180;
        liquidity = metadata.virtualSolReserves * solPrice;
      }
      
      // Get price if available
      if (metadata.initialPrice) {
        price = metadata.initialPrice;
      }
      
      logger.debug(`PumpFun token ${token.symbol} - MC: ${marketCap.toFixed(2)}, Liq: ${liquidity.toFixed(2)}`);
    }

    // Check on DexScreener for market data (but don't require it)
    try {
      const pairs = await this.dexScreener.getTokenPairs(token.address);

      if (pairs && pairs.length > 0) {
        const primaryPair = pairs[0];
        
        // Override with DexScreener data if available
        marketCap = parseFloat(primaryPair.fdv?.toString() || '0') || marketCap;
        liquidity = parseFloat(primaryPair.liquidity?.toString() || '0') || liquidity;
        volume24h = parseFloat(primaryPair.volume24h?.toString() || '0');
        price = primaryPair.priceUsd || price;
        
        logger.debug(`DexScreener data for ${token.symbol} - MC: ${marketCap.toFixed(2)}, Liq: ${liquidity.toFixed(2)}`);
      } else {
        logger.debug(`No DexScreener pairs for ${token.symbol}, using metadata values`);
      }

    } catch (error) {
      logger.debug(`Error fetching DexScreener data for ${token.symbol}:`, error);
      // Continue with metadata values if DexScreener fails
    }

    // If we still don't have market cap or liquidity, skip tokens that require them
    if (marketCap === 0 && liquidity === 0 && criteria.minMarketCap && criteria.minMarketCap > 0) {
      logger.debug(`Token ${token.symbol} has no market data available`);
      return false;
    }

    // Check liquidity requirement
    if (criteria.requireLiquidity && (!liquidity || liquidity < (criteria.minLiquidity || 0))) {
      logger.debug(`Token ${token.symbol} failed liquidity check: ${liquidity} < ${criteria.minLiquidity}`);
      return false;
    }

    // Check market cap requirement
    if (criteria.minMarketCap && marketCap < criteria.minMarketCap) {
      logger.debug(`Token ${token.symbol} failed market cap check: ${marketCap} < ${criteria.minMarketCap}`);
      return false;
    }

    // Check volume requirement
    if (criteria.minVolume24h && volume24h < criteria.minVolume24h) {
      logger.debug(`Token ${token.symbol} failed volume check: ${volume24h} < ${criteria.minVolume24h}`);
      return false;
    }

    // All checks passed - emit event with market data
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

    logger.info(`✅ Token ${token.symbol} passed ${filterName} filter - MC: ${marketCap.toFixed(2)}, Liq: ${liquidity.toFixed(2)}, Vol: ${volume24h.toFixed(2)}`);

    return true;
  }

  getFilters(): Map<string, FilterCriteria> {
    return this.filters;
  }

  getFilterNames(): string[] {
    return Array.from(this.filters.keys());
  }

  getFilterCriteria(filterName: string): FilterCriteria | undefined {
    return this.filters.get(filterName);
  }
}