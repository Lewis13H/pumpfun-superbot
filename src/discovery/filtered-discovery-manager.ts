// src/discovery/filtered-discovery-manager.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { db } from '../database/postgres';
import { writeDiscoveryEvent } from '../database/questdb';
import { AddressValidator } from '../utils/address-validator';
import { DexScreenerClient } from '../api/dexscreener-client';
import { TokenMetadataFetcher } from '../utils/token-metadata-fetcher';
import { getRateLimitedConnection } from '../utils/rpc-rate-limiter';
import { Connection } from '@solana/web3.js';
import { categoryManager } from '../category/category-manager';
import { getCategoryFromMarketCap } from '../config/category-utils';

export class FilteredDiscoveryManager extends EventEmitter {
  private metadataFetcher!: TokenMetadataFetcher;
  private monitors: Map<string, BaseMonitor> = new Map();
  private discoveredTokens: Set<string> = new Set();
  private dexScreener: DexScreenerClient;
  private stats = {
    totalDiscovered: 0,
    savedTokens: 0,
    duplicatesFound: 0,
    errorsEncountered: 0,
    invalidAddresses: 0,
    categoryDistribution: {} as Record<string, number>,
  };

  constructor() {
    super();
    this.dexScreener = new DexScreenerClient();
    this.metadataFetcher = new TokenMetadataFetcher(getRateLimitedConnection() as Connection);
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Discovery Manager - ALL tokens will be saved');
    this.metadataFetcher = new TokenMetadataFetcher(getRateLimitedConnection() as Connection);
    
    // Load existing tokens to prevent re-discovery
    await this.loadExistingTokens();
    
    // Initialize category stats
    const categories = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'];
    categories.forEach(cat => {
      this.stats.categoryDistribution[cat] = 0;
    });
    
    logger.info('Discovery Manager initialized');
  }

  private async loadExistingTokens(): Promise<void> {
    try {
      const existingTokens = await db('tokens')
        .select('address')
        .limit(10000);
      
      existingTokens.forEach(token => {
        this.discoveredTokens.add(token.address);
      });
      
      logger.info(`Loaded ${existingTokens.length} existing tokens`);
    } catch (error) {
      logger.error('Failed to load existing tokens:', error);
    }
  }

  registerMonitor(monitor: BaseMonitor): void {
    const monitorName = monitor.constructor.name;
    
    if (this.monitors.has(monitorName)) {
      logger.warn(`Monitor ${monitorName} already registered`);
      return;
    }

    // Set up event handlers
    monitor.on('tokenDiscovered', async (token: TokenDiscovery) => {
      await this.handleTokenDiscovery(token);
    });

    monitor.on('error', (error: Error) => {
      logger.error(`Monitor error from ${monitorName}:`, error);
      this.stats.errorsEncountered++;
    });

    this.monitors.set(monitorName, monitor);
    logger.info(`Registered monitor: ${monitorName}`);
  }

  async startAll(): Promise<void> {
    logger.info('Starting all monitors - Category-based system active');
    
    const startPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.start().catch(error => {
        logger.error(`Failed to start monitor:`, error);
      })
    );

    await Promise.all(startPromises);
    logger.info(`Started ${this.monitors.size} monitors`);
    
    // Start periodic stats reporting
    this.startStatsReporting();
  }

  private startStatsReporting(): void {
    setInterval(() => {
      logger.info('Discovery Stats:', {
        totalDiscovered: this.stats.totalDiscovered,
        savedTokens: this.stats.savedTokens,
        saveRate: this.stats.totalDiscovered > 0 
          ? ((this.stats.savedTokens / this.stats.totalDiscovered) * 100).toFixed(2) + '%'
          : '0%',
        categoryDistribution: this.stats.categoryDistribution,
      });
    }, 300000); // Every 5 minutes
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping all monitors');
    
    const stopPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.stop().catch(error => {
        logger.error(`Failed to stop monitor:`, error);
      })
    );

    await Promise.all(stopPromises);
    logger.info('All monitors stopped');
  }

  private async handleTokenDiscovery(token: TokenDiscovery): Promise<void> {
    this.stats.totalDiscovered++;
    
    // Validate and sanitize token data
    const sanitizedToken = AddressValidator.sanitizeTokenData(token);
    
    if (!sanitizedToken) {
      this.stats.invalidAddresses++;
      return;
    }

    // Check for duplicates
    if (this.discoveredTokens.has(sanitizedToken.address)) {
      this.stats.duplicatesFound++;
      logger.debug(`Duplicate token found: ${sanitizedToken.address}`);
      return;
    }

    // Mark as discovered
    this.discoveredTokens.add(sanitizedToken.address);

    // SAVE ALL TOKENS - NO FILTERING
    logger.info(`📝 Saving new token: ${sanitizedToken.symbol} (${sanitizedToken.address})`);

    try {
      // Get initial market data from DexScreener
      const pairs = await this.dexScreener.getTokenPairs(sanitizedToken.address);
      let marketData = {
        marketCap: 0,
        price: 0,
        liquidity: 0,
        volume24h: 0
      };

      if (pairs && pairs.length > 0) {
        const pair = pairs[0];
        marketData = {
          marketCap: sanitizedToken.metadata?.marketCap || parseFloat(pair.fdv?.toString() || '0'),
          price: parseFloat(pair.priceUsd?.toString() || '0'),
          liquidity: parseFloat(pair.liquidity?.toString() || '0'),
          volume24h: parseFloat(pair.volume24h?.toString() || '0')
        };

        // Update token info from DexScreener if available
        if (pair.baseToken?.symbol && pair.baseToken.symbol !== sanitizedToken.symbol) {
          sanitizedToken.symbol = pair.baseToken.symbol;
        }
        if (pair.baseToken?.name && pair.baseToken.name !== sanitizedToken.name) {
          sanitizedToken.name = pair.baseToken.name;
        }
      }

      // For PumpFun tokens, use initial data if DexScreener has nothing
      if (sanitizedToken.platform === 'pumpfun' && marketData.marketCap === 0) {
        const pumpfunData = sanitizedToken.metadata as any;
        
        if (pumpfunData?.vSolInBondingCurve && pumpfunData?.vTokensInBondingCurve) {
          const solPrice = 180; // Could be made dynamic
          const initialPrice = pumpfunData.vSolInBondingCurve / (pumpfunData.vTokensInBondingCurve / 1_000_000);
          marketData = {
            marketCap: 4000, // PumpFun starts at $4k market cap
            price: initialPrice * solPrice / 1_000_000_000,
            liquidity: pumpfunData.vSolInBondingCurve * solPrice,
            volume24h: 0
          };
          logger.info(`📊 Using PumpFun initial data: MC=$${marketData.marketCap}`);
        }
      }

      // Determine initial category based on market cap
      const initialCategory = getCategoryFromMarketCap(marketData.marketCap);
      this.stats.categoryDistribution[initialCategory]++;

      // Extract pump.fun metadata
      const metadata = sanitizedToken.metadata || {};
      const pumpfunData: any = {};

      if (sanitizedToken.platform === 'pumpfun') {
        pumpfunData.creator = metadata.creator || metadata.traderPublicKey;
        pumpfunData.bonding_curve = metadata.bondingCurve || metadata.bonding_curve || metadata.bondingCurveKey;
        pumpfunData.associated_bonding_curve = metadata.associatedBondingCurve || metadata.associated_bonding_curve;
        pumpfunData.initial_price_sol = metadata.initialPrice || metadata.initial_price;
        pumpfunData.initial_liquidity_sol = metadata.initialSolAmount || metadata.initial_liquidity;
        pumpfunData.is_pump_fun = true;
        
        // Calculate graduation progress (graduation at $69,000 market cap)
        if (marketData.marketCap > 0) {
          pumpfunData.curve_progress = Math.min(marketData.marketCap / 69000, 1.0);
          pumpfunData.distance_to_graduation = Math.max(69000 - marketData.marketCap, 0);
        }
      }

      // SAVE TO DATABASE
      await db('tokens').insert({
        address: sanitizedToken.address,
        symbol: sanitizedToken.symbol || 'UNKNOWN',
        name: sanitizedToken.name || 'Unknown Token',
        platform: sanitizedToken.platform,
        created_at: sanitizedToken.createdAt,
        discovered_at: new Date(),
        decimals: 6,
        
        // Market data
        market_cap: marketData.marketCap,
        current_price: marketData.price,
        liquidity: marketData.liquidity,
        volume_24h: marketData.volume24h,
        
        // Category system
        category: initialCategory,
        category_updated_at: new Date(),
        category_scan_count: 0,
        
        // Pump.fun fields
        ...pumpfunData,
        
        // Store metadata
        raw_data: JSON.stringify({
          ...sanitizedToken.metadata,
          marketData,
          initialCategory,
          discoveryTimestamp: new Date(),
        }),
        
        // Status
        status: 'active',
        analysis_status: 'PENDING',
      }).onConflict('address').ignore();

      this.stats.savedTokens++;

      // Create metrics entry
      await db('enhanced_token_metrics')
        .insert({
          token_address: sanitizedToken.address,
          market_cap: marketData.marketCap,
          total_liquidity: marketData.liquidity,
          volume_24h: marketData.volume24h,
          graduation_distance: pumpfunData.curve_progress || 0,
          liquidity_to_mc_ratio: marketData.marketCap > 0 ? marketData.liquidity / marketData.marketCap : 0,
          volume_to_liquidity_ratio: marketData.liquidity > 0 ? marketData.volume24h / marketData.liquidity : 0,
          last_updated: new Date()
        })
        .onConflict('token_address')
        .merge();

      // Write to QuestDB
      await writeDiscoveryEvent({
        tokenAddress: sanitizedToken.address,
        platform: sanitizedToken.platform,
        eventType: 'discovered',
        details: `${sanitizedToken.symbol} - Category: ${initialCategory}, MC: $${marketData.marketCap}`,
      });

      logger.info(`✅ Token saved: ${sanitizedToken.symbol} - Category: ${initialCategory}, MC=$${marketData.marketCap}`);

      // Create state machine for the token
      await categoryManager.createOrRestoreStateMachine(
        sanitizedToken.address,
        initialCategory,
        {
          currentMarketCap: marketData.marketCap,
          scanCount: 0,
        }
      );

      // Emit discovery event
      this.emit('tokenDiscovered', {
        ...sanitizedToken,
        marketData,
        category: initialCategory,
      });

    } catch (error) {
      logger.error('Failed to save discovered token:', error);
      this.stats.errorsEncountered++;
    }
  }

  getStats() {
    return {
      ...this.stats,
      monitorsActive: this.monitors.size,
      uniqueTokens: this.discoveredTokens.size,
      categorySaveRate: Object.entries(this.stats.categoryDistribution)
        .map(([cat, count]) => ({
          category: cat,
          count,
          percentage: this.stats.savedTokens > 0 
            ? ((count / this.stats.savedTokens) * 100).toFixed(2) + '%'
            : '0%'
        })),
    };
  }
}

