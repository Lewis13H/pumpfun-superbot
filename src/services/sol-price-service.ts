// src/services/sol-price-service.ts
// CORRECTED VERSION - FIXES CONFIG IMPORT

import { EventEmitter } from 'events';
import axios from 'axios';
import { logger } from '../utils/logger2';
import { config } from '../config'; // ✅ FIXED: Correct import path (not ../config/config)
import { db } from '../database/postgres'; // Added for database storage

export interface SolPriceUpdate {
  price: number;
  previousPrice: number;
  change: number;
  timestamp: Date;
  source: string;
}

export interface PriceResult {
  price: number;
  source: string;
}

export class SolPriceService extends EventEmitter {
  private currentPrice: number = 100; // Fallback price
  private lastUpdate: Date = new Date();
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_FREQUENCY = 30000; // 30 seconds (improved from 60)
  private isInitialized: boolean = false;
  private consecutiveFailures: number = 0;
  private readonly MAX_FAILURES = 5;

  constructor() {
    super();
    this.setMaxListeners(20); // Increase listener limit
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('SOL Price Service already initialized');
      return;
    }

    try {
      // Get initial price immediately
      await this.updatePrice();
      
      // Start regular updates
      this.startPriceUpdates();
      
      this.isInitialized = true;
      logger.info('🚀 SOL Price Service initialized successfully');
      
      // Emit initialization event
      this.emit('initialized', {
        price: this.currentPrice,
        timestamp: this.lastUpdate
      });
      
    } catch (error) {
      logger.error('Failed to initialize SOL Price Service:', error);
      throw error;
    }
  }

  private startPriceUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      await this.updatePrice();
    }, this.UPDATE_FREQUENCY);

    logger.info(`📡 SOL price updates started (every ${this.UPDATE_FREQUENCY / 1000}s)`);
  }

  async updatePrice(): Promise<void> {
    try {
      const priceResult = await this.fetchPriceFromPrimary();
      
      if (priceResult && priceResult.price > 0) {
        const previousPrice = this.currentPrice;
        this.currentPrice = priceResult.price;
        this.lastUpdate = new Date();
        this.consecutiveFailures = 0; // Reset failure counter
        
        // ✅ Update global config (matches your existing pattern)
        config.SOL_PRICE_USD = priceResult.price;
        
        // Store in database (enhanced)
        await this.storePriceInDatabase(priceResult.price, priceResult.source);
        
        // Calculate price change
        const change = previousPrice > 0 ? ((priceResult.price - previousPrice) / previousPrice) * 100 : 0;
        
        // Emit price update event
        const updateData: SolPriceUpdate = {
          price: priceResult.price,
          previousPrice,
          change,
          timestamp: this.lastUpdate,
          source: priceResult.source
        };
        
        this.emit('priceUpdate', updateData);
        
        // Log significant changes (> $0.50 or > 2%)
        if (Math.abs(priceResult.price - previousPrice) > 0.5 || Math.abs(change) > 2) {
          const changeStr = change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
          logger.info(`💰 SOL price updated: $${previousPrice.toFixed(2)} → $${priceResult.price.toFixed(2)} (${changeStr}) [${priceResult.source}]`);
        }
        
        return;
      }
      
      // If primary failed, try fallback
      throw new Error('Primary price fetch failed');
      
    } catch (error) {
      this.consecutiveFailures++;
      logger.debug(`Primary SOL price fetch failed (${this.consecutiveFailures}/${this.MAX_FAILURES}):`, error);
      
      // Try fallback sources
      try {
        const fallbackResult = await this.fetchPriceFromFallback();
        if (fallbackResult && fallbackResult.price > 0) {
          const previousPrice = this.currentPrice;
          this.currentPrice = fallbackResult.price;
          this.lastUpdate = new Date();
          this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1); // Partial recovery
          
          config.SOL_PRICE_USD = fallbackResult.price;
          
          // Store fallback price
          await this.storePriceInDatabase(fallbackResult.price, `fallback_${fallbackResult.source}`);
          
          logger.info(`🔄 SOL price from fallback: $${fallbackResult.price.toFixed(2)} [${fallbackResult.source}]`);
          
          const updateData: SolPriceUpdate = {
            price: fallbackResult.price,
            previousPrice,
            change: previousPrice > 0 ? ((fallbackResult.price - previousPrice) / previousPrice) * 100 : 0,
            timestamp: this.lastUpdate,
            source: fallbackResult.source
          };
          
          this.emit('priceUpdate', updateData);
          return;
        }
      } catch (fallbackError) {
        logger.error('Fallback price fetch also failed:', fallbackError);
      }
      
      // If too many consecutive failures, emit error
      if (this.consecutiveFailures >= this.MAX_FAILURES) {
        logger.error(`❌ SOL price service failed ${this.MAX_FAILURES} times consecutively`);
        this.emit('error', new Error(`Failed to fetch SOL price ${this.MAX_FAILURES} times`));
      }
    }
  }

  private async fetchPriceFromPrimary(): Promise<PriceResult | null> {
    // Try Binance first (no API key required, most reliable)
    try {
      const response = await axios.get(
        'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
        { 
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOL-Price-Service/1.0)'
          }
        }
      );
      
      if (response.data && response.data.price) {
        const price = parseFloat(response.data.price);
        if (price > 0 && price < 10000) { // Sanity check
          return {
            price,
            source: 'binance'
          };
        }
      }
    } catch (error) {
      logger.debug('Binance price fetch failed:', error);
    }
    
    // Try CoinGecko Pro (if API key available)
    if (config.COINGECKO_API_KEY) {
      try {
        const response = await axios.get(
          'https://pro-api.coingecko.com/api/v3/simple/price',
          {
            params: {
              ids: 'solana',
              vs_currencies: 'usd',
              precision: 2
            },
            headers: {
              'x-cg-pro-api-key': config.COINGECKO_API_KEY
            },
            timeout: 5000
          }
        );
        
        if (response.data && response.data.solana && response.data.solana.usd) {
          const price = response.data.solana.usd;
          if (price > 0 && price < 10000) {
            return {
              price,
              source: 'coingecko_pro'
            };
          }
        }
      } catch (error) {
        logger.debug('CoinGecko Pro price fetch failed:', error);
      }
    }
    
    // Try CoinGecko Free (rate limited but reliable)
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { 
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOL-Price-Service/1.0)'
          }
        }
      );
      
      if (response.data && response.data.solana && response.data.solana.usd) {
        const price = response.data.solana.usd;
        if (price > 0 && price < 10000) {
          return {
            price,
            source: 'coingecko_free'
          };
        }
      }
    } catch (error) {
      logger.debug('CoinGecko Free price fetch failed:', error);
    }
    
    return null;
  }

  private async fetchPriceFromFallback(): Promise<PriceResult | null> {
    // Try Jupiter API
    try {
      const response = await axios.get(
        'https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112',
        { 
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOL-Price-Service/1.0)'
          }
        }
      );
      
      if (response.data && response.data.data && response.data.data['So11111111111111111111111111111111111111112']) {
        const price = response.data.data['So11111111111111111111111111111111111111112'].price;
        if (price > 0 && price < 10000) {
          return {
            price,
            source: 'jupiter'
          };
        }
      }
    } catch (error) {
      logger.debug('Jupiter price fetch failed:', error);
    }

    // Try CryptoCompare as last resort
    try {
      const response = await axios.get(
        'https://min-api.cryptocompare.com/data/price?fsym=SOL&tsyms=USD',
        { 
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOL-Price-Service/1.0)'
          }
        }
      );
      
      if (response.data && response.data.USD) {
        const price = response.data.USD;
        if (price > 0 && price < 10000) {
          return {
            price,
            source: 'cryptocompare'
          };
        }
      }
    } catch (error) {
      logger.debug('CryptoCompare price fetch failed:', error);
    }
    
    return null;
  }

  // Enhanced database storage (optional - only if table exists)
  private async storePriceInDatabase(price: number, source: string): Promise<void> {
    try {
      await db('sol_price_history').insert({
        price: price,
        source: source,
        timestamp: new Date()
      });
      
      // Clean up old history (keep last 7 days)
      await db('sol_price_history')
        .where('timestamp', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .del();
        
    } catch (error) {
      logger.debug('Failed to store SOL price in database (table may not exist):', error);
      // Don't fail the price update if database fails
    }
  }

  // Public getters (matches your existing API)
  getPrice(): number {
    return this.currentPrice;
  }

  getCurrentPrice(): number {
    return this.currentPrice;
  }

  getLastUpdate(): Date {
    return this.lastUpdate;
  }

  // ✅ Keep your existing method name/signature
  getPriceData() {
    return {
      price: this.currentPrice,
      timestamp: this.lastUpdate,
      source: 'aggregate'
    };
  }

  isStale(): boolean {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    return Date.now() - this.lastUpdate.getTime() > staleThreshold;
  }

  getStats() {
    return {
      currentPrice: this.currentPrice,
      lastUpdate: this.lastUpdate,
      isStale: this.isStale(),
      isInitialized: this.isInitialized,
      consecutiveFailures: this.consecutiveFailures,
      updateFrequency: this.UPDATE_FREQUENCY,
      uptime: this.isInitialized ? Date.now() - this.lastUpdate.getTime() : 0
    };
  }

  // Manual price override for testing
  setPrice(price: number, source: string = 'manual'): void {
    const previousPrice = this.currentPrice;
    this.currentPrice = price;
    this.lastUpdate = new Date();
    config.SOL_PRICE_USD = price;
    
    logger.info(`🔧 SOL price manually set to $${price} (${source})`);
    
    this.emit('priceUpdate', {
      price,
      previousPrice,
      change: ((price - previousPrice) / previousPrice) * 100,
      timestamp: this.lastUpdate,
      source
    });
  }

  // Cleanup
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.removeAllListeners();
    this.isInitialized = false;
    
    logger.info('🛑 SOL Price Service stopped');
  }

  // Force immediate update
  async forceUpdate(): Promise<void> {
    logger.info('🔄 Forcing SOL price update...');
    await this.updatePrice();
  }
}

// Singleton instance
export const SOL_PRICE_SERVICE = new SolPriceService();

// Auto-initialize when imported
SOL_PRICE_SERVICE.initialize().catch(error => {
  logger.error('Failed to auto-initialize SOL price service:', error);
  
  // Set fallback price if initialization fails
  SOL_PRICE_SERVICE.setPrice(100, 'fallback_initialization');
});

// Export for easy access (matches your existing pattern)
export default SOL_PRICE_SERVICE;

// ✅ Keep your existing helper function
export function getSolPriceUSD(): number {
  return SOL_PRICE_SERVICE.getPrice();
}