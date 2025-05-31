// src/services/sol-price-service.ts

import { EventEmitter } from 'events';
import axios from 'axios';
import { logger } from '../utils/logger';
import { bondingCurveCalculator } from '../utils/pumpfun-bonding-curve';

export interface SolPriceData {
  priceUSD: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  timestamp: Date;
  source: string;
}

/**
 * Service to fetch and maintain current SOL price
 * Uses multiple sources for reliability
 */
export class SolPriceService extends EventEmitter {
  private currentPrice: number = 180; // Default fallback
  private priceHistory: SolPriceData[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  // Price sources in order of preference
  private readonly PRICE_SOURCES = [
    { name: 'coingecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true' },
    { name: 'binance', url: 'https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT' },
    { name: 'coinbase', url: 'https://api.coinbase.com/v2/exchange-rates?currency=SOL' },
  ];
  
  private readonly UPDATE_INTERVAL = 60000; // 1 minute
  private readonly MAX_HISTORY = 60; // Keep last hour of prices

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('SOL price service already running');
      return;
    }

    logger.info('Starting SOL price service...');
    this.isRunning = true;

    // Get initial price
    await this.updatePrice();

    // Set up periodic updates
    this.updateInterval = setInterval(() => {
      this.updatePrice().catch(error => {
        logger.error('Failed to update SOL price:', error);
      });
    }, this.UPDATE_INTERVAL);

    logger.info(`SOL price service started. Current price: $${this.currentPrice}`);
  }

  async stop(): Promise<void> {
    logger.info('Stopping SOL price service...');
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get current SOL price
   */
  getCurrentPrice(): number {
    return this.currentPrice;
  }

  /**
   * Get price history
   */
  getPriceHistory(): SolPriceData[] {
    return [...this.priceHistory];
  }

  /**
   * Get average price over a time period
   */
  getAveragePrice(minutes: number = 60): number {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const relevantPrices = this.priceHistory.filter(p => p.timestamp > cutoff);
    
    if (relevantPrices.length === 0) return this.currentPrice;
    
    const sum = relevantPrices.reduce((acc, p) => acc + p.priceUSD, 0);
    return sum / relevantPrices.length;
  }

  /**
   * Update price from available sources
   */
  private async updatePrice(): Promise<void> {
    let priceData: SolPriceData | null = null;

    // Try each source in order
    for (const source of this.PRICE_SOURCES) {
      try {
        priceData = await this.fetchFromSource(source);
        if (priceData && priceData.priceUSD > 0) {
          break; // Success, stop trying other sources
        }
      } catch (error) {
        logger.debug(`Failed to fetch from ${source.name}:`, error);
      }
    }

    if (!priceData) {
      logger.error('Failed to fetch SOL price from all sources');
      return;
    }

    // Update current price
    const previousPrice = this.currentPrice;
    this.currentPrice = priceData.priceUSD;

    // Update bonding curve calculator
    bondingCurveCalculator.setSolPrice(this.currentPrice);

    // Add to history
    this.priceHistory.push(priceData);
    if (this.priceHistory.length > this.MAX_HISTORY) {
      this.priceHistory.shift(); // Remove oldest
    }

    // Emit price update event
    this.emit('priceUpdate', {
      current: priceData,
      previous: previousPrice,
      change: ((priceData.priceUSD - previousPrice) / previousPrice) * 100,
    });

    // Log significant changes
    const priceChange = Math.abs(priceData.priceUSD - previousPrice);
    if (priceChange > 1) {
      logger.info(`SOL price updated: $${previousPrice.toFixed(2)} → $${priceData.priceUSD.toFixed(2)} (${priceChange > 0 ? '+' : ''}${((priceData.priceUSD - previousPrice) / previousPrice * 100).toFixed(2)}%)`);
    } else {
      logger.debug(`SOL price: $${priceData.priceUSD.toFixed(2)}`);
    }
  }

  /**
   * Fetch price from a specific source
   */
  private async fetchFromSource(source: { name: string; url: string }): Promise<SolPriceData | null> {
    const response = await axios.get(source.url, { timeout: 5000 });
    
    switch (source.name) {
      case 'coingecko':
        return this.parseCoingeckoResponse(response.data);
      case 'binance':
        return this.parseBinanceResponse(response.data);
      case 'coinbase':
        return this.parseCoinbaseResponse(response.data);
      default:
        return null;
    }
  }

  /**
   * Parse Coingecko response
   */
  private parseCoingeckoResponse(data: any): SolPriceData | null {
    try {
      const solData = data.solana;
      if (!solData) return null;

      return {
        priceUSD: solData.usd || 0,
        change24h: solData.usd_24h_change || 0,
        volume24h: solData.usd_24h_vol || 0,
        marketCap: solData.usd_market_cap || 0,
        timestamp: new Date(),
        source: 'coingecko',
      };
    } catch (error) {
      logger.error('Failed to parse Coingecko response:', error);
      return null;
    }
  }

  /**
   * Parse Binance response
   */
  private parseBinanceResponse(data: any): SolPriceData | null {
    try {
      return {
        priceUSD: parseFloat(data.lastPrice) || 0,
        change24h: parseFloat(data.priceChangePercent) || 0,
        volume24h: parseFloat(data.volume) * parseFloat(data.lastPrice) || 0,
        marketCap: 0, // Binance doesn't provide market cap
        timestamp: new Date(),
        source: 'binance',
      };
    } catch (error) {
      logger.error('Failed to parse Binance response:', error);
      return null;
    }
  }

  /**
   * Parse Coinbase response
   */
  private parseCoinbaseResponse(data: any): SolPriceData | null {
    try {
      const usdRate = data.data?.rates?.USD;
      if (!usdRate) return null;

      return {
        priceUSD: parseFloat(usdRate) || 0,
        change24h: 0, // Coinbase doesn't provide 24h change in this endpoint
        volume24h: 0, // Coinbase doesn't provide volume in this endpoint
        marketCap: 0, // Coinbase doesn't provide market cap in this endpoint
        timestamp: new Date(),
        source: 'coinbase',
      };
    } catch (error) {
      logger.error('Failed to parse Coinbase response:', error);
      return null;
    }
  }

  /**
   * Get price statistics
   */
  getStats() {
    const prices = this.priceHistory.map(p => p.priceUSD);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    return {
      current: this.currentPrice,
      min1h: min,
      max1h: max,
      avg1h: avg,
      volatility: ((max - min) / avg) * 100,
      historySize: this.priceHistory.length,
      lastUpdate: this.priceHistory[this.priceHistory.length - 1]?.timestamp,
    };
  }
}

// Export singleton instance
export const solPriceService = new SolPriceService();