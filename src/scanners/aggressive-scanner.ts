// src/scanners/aggressive-scanner.ts
import { EventEmitter } from 'events';
import { db } from '../database/postgres';
import { BirdeyeClient } from '../api/birdeye-client';
import { DexScreenerClient } from '../api/dexscreener-client';
import { logger } from '../utils/logger';
import { TokenCategory } from '../config/category-config';

interface ScannerConfig {
  category: TokenCategory;
  batchSize: number;
  scanInterval: number; // milliseconds
  maxConcurrent: number;
}

export class AggressiveScanner extends EventEmitter {
  private configs: Map<TokenCategory, ScannerConfig> = new Map([
    ['NEW', { category: 'NEW', batchSize: 50, scanInterval: 30000, maxConcurrent: 10 }],
    ['HIGH', { category: 'HIGH', batchSize: 20, scanInterval: 15000, maxConcurrent: 5 }],
    ['AIM', { category: 'AIM', batchSize: 10, scanInterval: 5000, maxConcurrent: 5 }],
  ]);
  
  private running = false;
  private scanners: Map<TokenCategory, NodeJS.Timeout> = new Map();
  private birdeye: BirdeyeClient;
  private dexscreener: DexScreenerClient;
  
  constructor() {
    super();
    this.birdeye = new BirdeyeClient(process.env.BIRDEYE_API_KEY || '');
    this.dexscreener = new DexScreenerClient();
  }
  
  async start(): Promise<void> {
    logger.info('🚀 Starting aggressive scanners...');
    this.running = true;
    
    // Start scanner for each configured category
    for (const [category, config] of this.configs) {
      this.startCategoryScanner(category, config);
    }
    
    // Start timeout processor
    this.startTimeoutProcessor();
  }
  
  private startCategoryScanner(category: TokenCategory, config: ScannerConfig): void {
    const scanner = setInterval(async () => {
      if (!this.running) return;
      
      try {
        await this.scanCategory(category, config);
      } catch (error: any) {
        logger.error(`Scanner error for ${category}:`, error);
      }
    }, config.scanInterval);
    
    this.scanners.set(category, scanner);
    logger.info(`Started ${category} scanner: every ${config.scanInterval/1000}s, batch ${config.batchSize}`);
  }
  
  private async scanCategory(category: TokenCategory, config: ScannerConfig): Promise<void> {
    // Get tokens to scan
    const tokens = await db('tokens')
      .where('category', category)
      .where(function() {
        this.whereNull('last_scan_at')
          .orWhere('last_scan_at', '<', db.raw(`NOW() - INTERVAL '${config.scanInterval / 1000} seconds'`));
      })
      .orderBy('last_scan_at', 'asc')
      .limit(config.batchSize)
      .select('address', 'symbol', 'market_cap', 'curve_progress', 'bonding_curve');
    
    if (tokens.length === 0) return;
    
    logger.debug(`Scanning ${tokens.length} ${category} tokens...`);
    
    // Process in parallel with concurrency limit
    const chunks = this.chunkArray(tokens, config.maxConcurrent);
    for (const chunk of chunks) {
      await Promise.all(chunk.map(token => this.scanToken(token, category)));
    }
    
    this.emit('scanComplete', { category, count: tokens.length });
  }
  
  private async scanToken(token: any, category: TokenCategory): Promise<void> {
    try {
      // Fetch market data
      let marketData = await this.fetchMarketData(token.address, token.curve_progress);
      
      if (!marketData) {
        // Just update scan timestamp
        await db('tokens')
          .where('address', token.address)
          .update({
            last_scan_at: new Date(),
            category_scan_count: db.raw('category_scan_count + 1')
          });
        return;
      }
      
      // Update token with new data
      await db('tokens')
        .where('address', token.address)
        .update({
          market_cap: marketData.marketCap,
          liquidity: marketData.liquidity,
          holders: marketData.holders,
          volume_24h: marketData.volume24h,
          last_scan_at: new Date(),
          category_scan_count: db.raw('category_scan_count + 1'),
          updated_at: new Date()
        });
      
      // Log significant changes
      if (marketData.marketCap > token.market_cap * 1.5) {
        logger.info(`📈 ${token.symbol} surged: $${token.market_cap} → $${marketData.marketCap}`);
        this.emit('surge', { token, oldMc: token.market_cap, newMc: marketData.marketCap });
      }
      
      // Special logging for graduated tokens with real market cap
      if (token.curve_progress >= 0.99 && Math.abs(token.market_cap - 69000) < 1000 && marketData.marketCap > 70000) {
        logger.info(`🎓 ${token.symbol} graduated! Real MC: $${marketData.marketCap.toLocaleString()}`);
      }
      
    } catch (error: any) {
      logger.error(`Error scanning ${token.symbol}:`, error);
    }
  }
  
  private async fetchMarketData(address: string, curveProgress?: number): Promise<any> {
    try {
      // Check if this is a graduated pump.fun token
      if (curveProgress !== undefined && curveProgress >= 0.99) {
        // Skip Birdeye for graduated tokens, go straight to DEX
        logger.debug(`Token ${address} is graduated (${curveProgress}), using DEX data`);
        return this.fetchFromDexScreener(address);
      }
      
      // For non-graduated tokens, try Birdeye first
      const data = await this.birdeye.getTokenOverview(address);
      if (data) {
        return {
          marketCap: data.marketCap || 0,
          liquidity: data.liquidity || 0,
          holders: data.holders || 0,
          volume24h: data.volume24h || 0
        };
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        // Rate limited - wait and retry with DexScreener
        await new Promise(resolve => setTimeout(resolve, 5000));
        return this.fetchFromDexScreener(address);
      }
      throw error;
    }
    return null;
  }
  
  private async fetchFromDexScreener(address: string): Promise<any> {
    try {
      const pairs = await this.dexscreener.getTokenPairs(address);
      if (pairs && pairs.length > 0) {
        const pair = pairs[0];
        
        return {
          marketCap: pair.fdv || 0,
          liquidity: pair.liquidity.usd || 0,
          volume24h: pair.volume.h24 || 0,
          holders: 0 // DexScreener doesn't provide holder count
        };
      }
    } catch (error) {
      logger.debug(`DexScreener fetch failed for ${address}:`, error);
    }
    return null;
  }
  
  private startTimeoutProcessor(): void {
    setInterval(async () => {
      try {
        // Move timed-out NEW tokens to LOW
        const result = await db('tokens')
          .where('category', 'NEW')
          .where('created_at', '<', db.raw("NOW() - INTERVAL '30 minutes'"))
          .where('market_cap', '<', 8000)
          .update({
            category: 'LOW',
            category_updated_at: new Date(),
            category_scan_count: 0
          });
        
        if (result > 0) {
          logger.info(`⏰ Moved ${result} NEW tokens to LOW (timeout)`);
        }
        
        // Also fix any graduated tokens stuck at $69k
        const graduatedStuck = await db('tokens')
          .where('curve_progress', '>=', 0.99)
          .where('market_cap', '>=', 68000)
          .where('market_cap', '<=', 70000)
          .limit(10)
          .select('address', 'symbol');
        
        if (graduatedStuck.length > 0) {
          logger.info(`🔧 Found ${graduatedStuck.length} graduated tokens stuck at $69k, re-scanning...`);
          for (const token of graduatedStuck) {
            await this.scanToken({ ...token, curve_progress: 1 }, 'AIM');
          }
        }
        
      } catch (error: any) {
        logger.error('Timeout processor error:', error);
      }
    }, 60000); // Every minute
  }
  
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  async stop(): Promise<void> {
    this.running = false;
    for (const [category, timer] of this.scanners) {
      clearInterval(timer);
    }
    this.scanners.clear();
    logger.info('Aggressive scanners stopped');
  }
}

// Export singleton
export const aggressiveScanner = new AggressiveScanner();