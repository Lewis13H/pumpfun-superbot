// src/discovery/filtered-discovery-manager.ts
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { db } from '../database/postgres';
import { writeDiscoveryEvent } from '../database/questdb';
import { AddressValidator } from '../utils/address-validator';
import { SmartTokenFilter } from './smart-token-filter';
import { DexScreenerClient } from '../api/dexscreener-client';

export class FilteredDiscoveryManager extends EventEmitter {
  private monitors: Map<string, BaseMonitor> = new Map();
  private discoveredTokens: Set<string> = new Set();
  private tokenEnrichmentService: any;
  private smartFilter: SmartTokenFilter;
  private dexScreener: DexScreenerClient;
  private activeFilterName: string = 'moderate';
  private stats = {
    totalDiscovered: 0,
    passedFilter: 0,
    failedFilter: 0,
    duplicatesFound: 0,
    errorsEncountered: 0,
    invalidAddresses: 0,
  };

  constructor() {
    super();
    this.smartFilter = new SmartTokenFilter();
    this.dexScreener = new DexScreenerClient();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Filtered Discovery Manager');
    
    // Load existing tokens to prevent re-discovery
    await this.loadExistingTokens();
    
    // Load filter settings
    await this.loadFilterSettings();
    
    // Listen for tokens that pass the filter
    this.smartFilter.on('tokenPassedFilter', (data) => {
      logger.info(`Token ${data.token.symbol} passed ${data.filterName} filter with MC=$${data.marketData.marketCap}`);
    });
  }

  private async loadFilterSettings(): Promise<void> {
    try {
      const settings = await db('discovery_settings')
        .where('setting_key', 'active_filter')
        .first();
      
      if (settings && settings.setting_value) {
        const filterConfig = typeof settings.setting_value === 'string' 
          ? JSON.parse(settings.setting_value) 
          : settings.setting_value;
        this.activeFilterName = filterConfig.name;
        logger.info(`Loaded filter setting: ${this.activeFilterName}`);
      }
    } catch (error) {
      logger.error('Error loading filter settings:', error);
    }
  }

  setEnrichmentService(enrichmentService: any): void {
    this.tokenEnrichmentService = enrichmentService;
    logger.info('Token enrichment service connected to filtered discovery manager');
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
    logger.info('Starting all monitors with filtering enabled');
    logger.info(`Active filter: ${this.activeFilterName}`);
    
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
      const passRate = this.stats.totalDiscovered > 0 
        ? ((this.stats.passedFilter / this.stats.totalDiscovered) * 100).toFixed(2)
        : '0';
      
      logger.info(`Discovery Stats: Total=${this.stats.totalDiscovered}, Passed=${this.stats.passedFilter} (${passRate}%), Failed=${this.stats.failedFilter}`);
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

    // Apply smart filter BEFORE saving
    logger.debug(`Checking if ${sanitizedToken.symbol} passes filter...`);
    
    const passesFilter = await this.smartFilter.shouldProcessToken(sanitizedToken, this.activeFilterName);
    
    if (!passesFilter) {
      this.stats.failedFilter++;
      logger.debug(`Token ${sanitizedToken.symbol} (${sanitizedToken.address}) failed filter`);
      
      // Optionally store basic info about filtered tokens
      await this.storeFilteredToken(sanitizedToken);
      
      return;
    }

    this.stats.passedFilter++;
    logger.info(`✓ Token ${sanitizedToken.symbol} PASSED filter - saving to database`);

    // Mark as discovered
    this.discoveredTokens.add(sanitizedToken.address);

    // Get fresh market data since it passed the filter
    try {
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
          marketCap: parseFloat(pair.fdv?.toString() || '0'),
          price: parseFloat(pair.priceUsd?.toString() || '0'),
          liquidity: parseFloat(pair.liquidity?.toString() || '0'),
          volume24h: parseFloat(pair.volume24h?.toString() || '0')
        };

        // For PumpFun tokens, calculate liquidity from SOL reserves if DexScreener reports zero
        if (sanitizedToken.platform === 'pumpfun' && marketData.liquidity === 0) {
          // Check if we have PumpFun-specific data in token metadata
          const pumpfunData = (sanitizedToken.metadata as any)?.pumpfunData || (sanitizedToken as any).pumpfunData;
          
          if (pumpfunData?.real_sol_reserves) {
            const solPrice = 180; // Approximate SOL price - could be made dynamic
            const calculatedLiquidity = pumpfunData.real_sol_reserves * solPrice;
            marketData.liquidity = calculatedLiquidity;
            logger.info(`📊 PumpFun liquidity calculated from ${pumpfunData.real_sol_reserves} SOL = $${calculatedLiquidity.toFixed(2)}`);
          } else if (marketData.marketCap > 0) {
            // Fallback: estimate based on market cap for PumpFun bonding curve
            // PumpFun bonding curve typically has ~3-5% of market cap as SOL reserves
            const estimatedSolReserves = (marketData.marketCap * 0.04) / 180; // 4% of MC in SOL
            marketData.liquidity = estimatedSolReserves * 180;
            logger.info(`📊 PumpFun liquidity estimated from MC: $${marketData.liquidity.toFixed(2)} (${estimatedSolReserves.toFixed(2)} SOL)`);
          }
        }

        // Update token name and symbol from DexScreener if we have better data
        if (pair.baseToken?.symbol && pair.baseToken.symbol !== sanitizedToken.symbol) {
          sanitizedToken.symbol = pair.baseToken.symbol;
        }
        if (pair.baseToken?.name && pair.baseToken.name !== sanitizedToken.name) {
          sanitizedToken.name = pair.baseToken.name;
        }
      }

      // Extract pump.fun specific metadata
      const metadata = sanitizedToken.metadata || {};
      const pumpfunData: any = {};

      // Check various possible locations for pump.fun data
      if (sanitizedToken.platform === 'pumpfun') {
        // Extract from metadata
        pumpfunData.creator = metadata.creator || metadata.traderPublicKey;
        pumpfunData.bonding_curve = metadata.bondingCurve || metadata.bonding_curve;
        pumpfunData.associated_bonding_curve = metadata.associatedBondingCurve || metadata.associated_bonding_curve;
        pumpfunData.creator_vault = metadata.creatorVault || metadata.creator_vault;
        pumpfunData.initial_price_sol = metadata.initialPrice || metadata.initial_price;
        pumpfunData.initial_liquidity_sol = metadata.initialSolAmount || metadata.initial_liquidity;
        pumpfunData.is_pump_fun = true;
        
        // Calculate curve progress if we have market cap
        if (marketData.marketCap > 0) {
          pumpfunData.curve_progress = Math.min(marketData.marketCap / 69420, 1.0);
          pumpfunData.distance_to_graduation = Math.max(69420 - marketData.marketCap, 0);
        }
      }

      // Store in database with market data and pump.fun fields
      await db('tokens').insert({
        address: sanitizedToken.address,
        symbol: sanitizedToken.symbol || 'UNKNOWN',
        name: sanitizedToken.name || 'Unknown Token',
        platform: sanitizedToken.platform,
        created_at: sanitizedToken.createdAt,
        discovered_at: new Date(),
        decimals: 6, // Default for Solana tokens
        // Market data
        market_cap: marketData.marketCap,
        current_price: marketData.price,
        liquidity: marketData.liquidity,
        volume_24h: marketData.volume24h,
        // Add pump.fun specific fields
        ...pumpfunData,
        // Store full metadata
        raw_data: JSON.stringify({
          ...sanitizedToken.metadata,
          marketData,
          passedFilter: this.activeFilterName,
          pumpfunLiquidityCalculated: sanitizedToken.platform === 'pumpfun' && marketData.liquidity > 0
        }),
        // Status fields
        status: 'active', // Mark as active since it passed filters
        analysis_status: 'PENDING'
      }).onConflict('address').ignore();

      // Create enhanced metrics
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
        eventType: 'discovered_active',
        details: `${sanitizedToken.symbol} - ${sanitizedToken.name} (MC: $${marketData.marketCap})`,
      });

      // Log discovery with market data
      logger.info(`New ACTIVE token saved: ${sanitizedToken.symbol} (${sanitizedToken.name}) - MC=$${marketData.marketCap}, Liq=$${marketData.liquidity}`);
      logger.info(`  Creator: ${pumpfunData.creator || 'N/A'}`);
      logger.info(`  Bonding Curve: ${pumpfunData.bonding_curve || 'N/A'}`);

      // Emit for further processing
      this.emit('tokenDiscovered', {
        ...sanitizedToken,
        marketData
      });
      
      // Add to enrichment queue for continuous monitoring
      if (this.tokenEnrichmentService) {
        await this.tokenEnrichmentService.enrichToken(sanitizedToken.address);
      }
      
    } catch (error) {
      logger.error('Failed to save discovered token:', error);
      this.stats.errorsEncountered++;
    }
  }

  private async storeFilteredToken(token: TokenDiscovery): Promise<void> {
    // Optionally store filtered tokens in a separate table for analysis
    try {
      await db('filtered_tokens')
        .insert({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          platform: token.platform,
          filtered_at: new Date(),
          filter_used: this.activeFilterName
        })
        .onConflict('address')
        .ignore();
    } catch (error) {
      // Table might not exist, ignore
    }
  }

  async updateFilter(filterName: string): Promise<void> {
    if (this.smartFilter.getFilters().has(filterName)) {
      this.activeFilterName = filterName;
      
      // Save to database
      await db('discovery_settings')
        .where('setting_key', 'active_filter')
        .update({
          setting_value: {  // Remove JSON.stringify
            name: filterName,
            updatedAt: new Date()
          }
        });
      
      logger.info(`Filter updated to: ${filterName}`);
    } else {
      logger.error(`Unknown filter: ${filterName}`);
    }
  }

  getStats() {
    return {
      ...this.stats,
      monitorsActive: this.monitors.size,
      uniqueTokens: this.discoveredTokens.size,
      activeFilter: this.activeFilterName,
      filterPassRate: this.stats.totalDiscovered > 0 
        ? ((this.stats.passedFilter / this.stats.totalDiscovered) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}