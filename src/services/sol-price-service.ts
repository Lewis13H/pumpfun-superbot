// src/services/sol-price-service.ts

import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';
import { EventEmitter } from 'events';

export interface PriceData {
  price: number;
  timestamp: Date;
  source: string;
}

class SolPriceService extends EventEmitter {
  private currentPrice: number = 100; // Default fallback
  private lastUpdate: Date = new Date();
  private updateInterval?: NodeJS.Timeout;
  private readonly UPDATE_FREQUENCY = 60000; // 1 minute
  
  async initialize(): Promise<void> {
    try {
      // Get initial price
      await this.updatePrice();
      
      // Start periodic updates
      this.updateInterval = setInterval(() => {
        this.updatePrice().catch(error => {
          logger.error('Failed to update SOL price:', error);
        });
      }, this.UPDATE_FREQUENCY);
      
      logger.info(`✅ SOL price service initialized: $${this.currentPrice}`);
      
    } catch (error) {
      logger.error('Failed to initialize SOL price service:', error);
      // Continue with default price
    }
  }
  
  async updatePrice(): Promise<void> {
    try {
      const price = await this.fetchPriceFromPrimary();
      
      if (price && price > 0) {
        const previousPrice = this.currentPrice;
        this.currentPrice = price;
        this.lastUpdate = new Date();
        
        // Update global config
        config.SOL_PRICE_USD = price;
        
        // Emit price update event
        this.emit('priceUpdate', {
          price,
          previousPrice,
          change: ((price - previousPrice) / previousPrice) * 100,
          timestamp: this.lastUpdate
        });
        
        logger.debug(`SOL price updated: $${price.toFixed(2)}`);
      }
    } catch (error) {
      logger.error('Error updating SOL price:', error);
      
      // Try fallback sources
      try {
        const fallbackPrice = await this.fetchPriceFromFallback();
        if (fallbackPrice && fallbackPrice > 0) {
          this.currentPrice = fallbackPrice;
          this.lastUpdate = new Date();
          config.SOL_PRICE_USD = fallbackPrice;
        }
      } catch (fallbackError) {
        logger.error('Fallback price fetch also failed:', fallbackError);
      }
    }
  }
  
  private async fetchPriceFromPrimary(): Promise<number | null> {
    // Try Binance first (no API key required)
    try {
      const response = await axios.get(
        'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
        { timeout: 5000 }
      );
      
      if (response.data && response.data.price) {
        return parseFloat(response.data.price);
      }
    } catch (error) {
      logger.debug('Binance price fetch failed:', error);
    }
    
    // Try CoinGecko (with optional API key)
    if (config.COINGECKO_API_KEY) {
      try {
        const response = await axios.get(
          'https://pro-api.coingecko.com/api/v3/simple/price',
          {
            params: {
              ids: 'solana',
              vs_currencies: 'usd'
            },
            headers: {
              'x-cg-pro-api-key': config.COINGECKO_API_KEY
            },
            timeout: 5000
          }
        );
        
        if (response.data && response.data.solana && response.data.solana.usd) {
          return response.data.solana.usd;
        }
      } catch (error) {
        logger.debug('CoinGecko price fetch failed:', error);
      }
    }
    
    return null;
  }
  
  private async fetchPriceFromFallback(): Promise<number | null> {
    // Try public CoinGecko API (rate limited)
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { timeout: 5000 }
      );
      
      if (response.data && response.data.solana && response.data.solana.usd) {
        return response.data.solana.usd;
      }
    } catch (error) {
      logger.debug('Public CoinGecko API failed:', error);
    }
    
    // Try Jupiter price API
    try {
      const response = await axios.get(
        'https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112',
        { timeout: 5000 }
      );
      
      if (response.data && response.data.data && response.data.data.So11111111111111111111111111111111111111112) {
        return response.data.data.So11111111111111111111111111111111111111112.price;
      }
    } catch (error) {
      logger.debug('Jupiter price API failed:', error);
    }
    
    return null;
  }
  
  getPrice(): number {
    return this.currentPrice;
  }
  
  getPriceData(): PriceData {
    return {
      price: this.currentPrice,
      timestamp: this.lastUpdate,
      source: 'aggregate'
    };
  }
  
  isStale(): boolean {
    // Consider price stale if not updated in last 5 minutes
    return Date.now() - this.lastUpdate.getTime() > 5 * 60 * 1000;
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    logger.info('SOL price service stopped');
  }
}

// Export singleton instance
export const SOL_PRICE_SERVICE = new SolPriceService();

// Helper function for other services
export function getSolPriceUSD(): number {
  return SOL_PRICE_SERVICE.getPrice();
}


