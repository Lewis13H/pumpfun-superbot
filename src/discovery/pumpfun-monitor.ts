// src/discovery/pumpfun-monitor.ts
import WebSocket from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import { getRateLimitedConnection } from '../utils/rpc-rate-limiter';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { config } from '../config';
import { logger } from '../utils/logger';
import { BondingCurveManager } from '../api/pumpfun/curve-manager';
import { PumpEventProcessor } from '../api/pumpfun/event-processor';
import { db } from '../database/postgres';
import { bondingCurveCalculator } from '../utils/pumpfun-bonding-curve';
import { solPriceService } from '../services/sol-price-service';
import { PUMP_FUN_CONSTANTS } from '../constants/pumpfun-constants';

// Enhanced token discovery interface with pump.fun specific data
export interface EnhancedTokenDiscovery extends TokenDiscovery {
  bondingCurve: string;
  associatedBondingCurve: string;
  creator: string;
  creatorVault: string;
  initialPrice?: number;
  initialLiquidity?: number;
  curveProgress?: number;
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
}

// Graduation tracking interface
export interface GraduationCandidate {
  tokenAddress: string;
  symbol: string;
  name: string;
  bondingCurve?: string;
  curveProgress: number;
  currentSolReserves: number;
  targetSolReserves: number;
  distanceToGraduation: number;
  estimatedTimeToGraduation?: number;
  priceAtGraduation?: number;
  currentPrice: number;
  marketCapUSD: number;
  targetMarketCapUSD: number;
}

export class EnhancedPumpFunMonitor extends BaseMonitor {
  private connection: Connection;
  private ws: WebSocket | null = null;
  private curveManager: BondingCurveManager;
  private eventProcessor: PumpEventProcessor;
  private pingInterval: NodeJS.Timeout | null = null;
  private subscriptionId: number | null = null;
  
  // Graduation tracking
  private graduationCheckInterval: NodeJS.Timeout | null = null;
  private trackedTokens: Map<string, GraduationCandidate & { tokensSold?: number }> = new Map();
  private readonly GRADUATION_CHECK_INTERVAL = 30000; // 30 seconds
  
  // PumpFun constants from the constants file
  private readonly PUMP_FUN_PROGRAM = new PublicKey(PUMP_FUN_CONSTANTS.PUMP_FUN_PROGRAM);
  private readonly PUMP_FUN_FEE = new PublicKey(PUMP_FUN_CONSTANTS.PUMP_FUN_FEE);
  private readonly PUMP_FUN_EVENT_AUTHORITY = new PublicKey(PUMP_FUN_CONSTANTS.PUMP_FUN_EVENT_AUTHORITY);

  constructor() {
    super('EnhancedPumpFun');
    this.connection = getRateLimitedConnection() as Connection;
    this.curveManager = new BondingCurveManager();
    this.eventProcessor = new PumpEventProcessor(this.PUMP_FUN_PROGRAM);
  }

  protected async startMonitoring(): Promise<void> {
    logger.info('Starting enhanced PumpFun monitoring with graduation tracking');
    
    // Start SOL price service if not already running
    if (solPriceService.getCurrentPrice() === 180) { // Default price
      await solPriceService.start();
      // Wait a moment for price to update
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    logger.info(`Current SOL price: $${solPriceService.getCurrentPrice()}`);
    
    // Load existing tokens to track
    await this.loadExistingTokensForTracking();
    
    // Start graduation tracking
    this.startGraduationTracking();
    
    // Start WebSocket as primary method (more reliable than logs)
    await this.connectWebSocket();
  }

  /**
   * Load existing pump.fun tokens for graduation tracking
   */
  private async loadExistingTokensForTracking(): Promise<void> {
    try {
      const existingTokens = await db('tokens')
        .where('platform', 'pumpfun')
        .where('is_pump_fun', true)
        .whereNotNull('bonding_curve')
        .where('market_cap', '>', 5000) // Track tokens with >$5k market cap
        .select('address', 'symbol', 'name', 'bonding_curve');

      for (const token of existingTokens) {
        await this.addTokenToGraduationTracking(token);
      }

      logger.info(`Loaded ${existingTokens.length} tokens for graduation tracking`);
    } catch (error) {
      logger.error('Error loading existing tokens:', error);
    }
  }

  /**
   * Start periodic graduation tracking
   */
  private startGraduationTracking(): void {
    this.graduationCheckInterval = setInterval(async () => {
      await this.checkGraduationCandidates();
    }, this.GRADUATION_CHECK_INTERVAL);

    // Run initial check
    this.checkGraduationCandidates();
  }

  /**
   * Check all tracked tokens for graduation progress
   */
  private async checkGraduationCandidates(): Promise<void> {
    const candidates: GraduationCandidate[] = [];
    const currentSolPrice = solPriceService.getCurrentPrice();

    for (const [tokenAddress, previousData] of this.trackedTokens) {
      try {
        const bondingCurve = previousData.bondingCurve || 
          await this.getBondingCurveAddress(tokenAddress);
          
        if (!bondingCurve) continue;

        // Get tokens sold from the bonding curve contract
        const tokensSold = await this.getTokensSoldFromCurve(bondingCurve);
        
        if (tokensSold === null) {
          logger.warn(`Failed to get tokens sold for bonding curve: ${bondingCurve}`);
          continue;
        }
        
        // Use the bonding curve calculator for accurate calculations
        const curveState = bondingCurveCalculator.getState(tokensSold);
        
        // Create graduation candidate with correct data
        const candidate: GraduationCandidate = {
          tokenAddress,
          symbol: previousData.symbol,
          name: previousData.name,
          bondingCurve: bondingCurve,
          curveProgress: curveState.progressPercent / 100, // Convert to 0-1 scale
          currentSolReserves: curveState.solRaised,
          targetSolReserves: PUMP_FUN_CONSTANTS.EXPECTED_SOL_AT_GRADUATION,
          distanceToGraduation: curveState.distanceToGraduation.usd,
          currentPrice: curveState.priceSOL,
          marketCapUSD: curveState.marketCapUSD,
          targetMarketCapUSD: PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD,
        };

        // Estimate time to graduation based on recent token sale velocity
        if (previousData.tokensSold !== undefined) {
          const tokensSoldDelta = tokensSold - previousData.tokensSold;
          const timeDelta = this.GRADUATION_CHECK_INTERVAL / 1000 / 60; // minutes
          
          if (tokensSoldDelta > 0) {
            const tokensPerMinute = tokensSoldDelta / timeDelta;
            candidate.estimatedTimeToGraduation = bondingCurveCalculator.estimateTimeToGraduation(
              curveState.marketCapUSD,
              tokensPerMinute * curveState.priceUSD // Convert to market cap growth rate
            ) || undefined;
          }
        }

        // Calculate price at graduation
        candidate.priceAtGraduation = PUMP_FUN_CONSTANTS.FINAL_PRICE_USD / solPriceService.getCurrentPrice();

        // Update tracked data with tokens sold
        this.trackedTokens.set(tokenAddress, {
          ...candidate,
          tokensSold // Store for next iteration
        });

        // Check if nearing graduation based on progress
        if (curveState.progressPercent >= 70) {
          candidates.push(candidate);
          
          // Emit graduation alert at different thresholds
          if (curveState.progressPercent >= 90) {
            this.emitGraduationAlert(candidate, 'IMMINENT');
          } else if (curveState.progressPercent >= 80) {
            this.emitGraduationAlert(candidate, 'APPROACHING');
          }
        }

        // Update database
        await this.updateTokenGraduationData(tokenAddress, candidate, tokensSold);

      } catch (error) {
        logger.error(`Error checking graduation for ${tokenAddress}:`, error);
      }
    }

    // Emit graduation candidates update
    if (candidates.length > 0) {
      this.emit('graduationCandidates', candidates);
      logger.info(`Found ${candidates.length} tokens nearing graduation`);
    }
  }

  /**
   * Get tokens sold from bonding curve
   * Fixed to use market cap progress for exponential curve
   */
  private async getTokensSoldFromCurve(bondingCurveAddress: string): Promise<number | null> {
    try {
      const token = await db('tokens')
        .where('bonding_curve', bondingCurveAddress)
        .first();
      
      if (token && token.market_cap) {
        // For exponential curve, calculate progress from market cap
        const marketCapUSD = token.market_cap;
        
        // Calculate progress (0 to 1) based on market cap range
        const progress = Math.max(0, Math.min(1, 
          (marketCapUSD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD) / 
          (PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD - PUMP_FUN_CONSTANTS.INITIAL_MARKET_CAP_USD)
        ));
        
        // Convert progress to tokens sold
        const tokensSold = progress * PUMP_FUN_CONSTANTS.BONDING_CURVE_SUPPLY;
        
        return tokensSold;
      }
      
      return 0; // Default to 0 if no data
    } catch (error) {
      logger.error('Error getting tokens sold from curve:', error);
      return null;
    }
  }

  /**
   * Add token to graduation tracking
   */
  private async addTokenToGraduationTracking(token: any): Promise<void> {
    try {
      const bondingCurve = token.bonding_curve || token.bondingCurve || token.bondingCurveKey;
      if (!bondingCurve) {
        logger.debug('No bonding curve address for token:', token.symbol);
        return;
      }

      // Get tokens sold for this token
      const tokensSold = await this.getTokensSoldFromCurve(bondingCurve);
      if (tokensSold === null) return;

      // Get curve state using the bonding curve calculator
      const curveState = bondingCurveCalculator.getState(tokensSold);
      
      // Track tokens that have at least $5,000 market cap (about 7% of graduation)
      if (curveState.marketCapUSD > 5000) {
        const candidate: GraduationCandidate = {
          tokenAddress: token.address || token.mint,
          symbol: token.symbol,
          name: token.name,
          bondingCurve: bondingCurve,
          curveProgress: curveState.progressPercent / 100, // Convert to 0-1 scale
          currentSolReserves: curveState.solRaised,
          targetSolReserves: PUMP_FUN_CONSTANTS.EXPECTED_SOL_AT_GRADUATION,
          distanceToGraduation: curveState.distanceToGraduation.usd,
          currentPrice: curveState.priceSOL,
          marketCapUSD: curveState.marketCapUSD,
          targetMarketCapUSD: PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD,
        };
        
        this.trackedTokens.set(token.address || token.mint, {
          ...candidate,
          tokensSold
        });

        const percentageToGraduation = curveState.progressPercent;
        logger.info(`Added ${token.symbol} to graduation tracking - $${curveState.marketCapUSD.toFixed(0)} market cap (${percentageToGraduation.toFixed(1)}% of graduation)`);
      }
    } catch (error) {
      logger.error(`Error adding token to graduation tracking:`, error);
    }
  }

  /**
   * Emit graduation alert
   */
  private emitGraduationAlert(candidate: GraduationCandidate, level: 'APPROACHING' | 'IMMINENT'): void {
    const progressPercentage = candidate.curveProgress * 100;
    
    const alert = {
      type: level === 'IMMINENT' ? 'GRADUATION_IMMINENT' : 'GRADUATION_APPROACHING',
      level,
      tokenAddress: candidate.tokenAddress,
      symbol: candidate.symbol,
      name: candidate.name,
      marketCapUSD: candidate.marketCapUSD,
      targetMarketCapUSD: PUMP_FUN_CONSTANTS.GRADUATION_MARKET_CAP_USD,
      progressPercent: progressPercentage,
      distanceToGraduation: candidate.distanceToGraduation,
      estimatedTimeMinutes: candidate.estimatedTimeToGraduation,
      currentPrice: candidate.currentPrice,
      estimatedPriceAtGraduation: candidate.priceAtGraduation,
      currentSolPrice: solPriceService.getCurrentPrice(),
      timestamp: new Date(),
    };

    this.emit('graduationAlert', alert);
    
    const emoji = level === 'IMMINENT' ? '🚨' : '⚠️';
    logger.warn(`${emoji} GRADUATION ${level}: ${candidate.symbol} at ${progressPercentage.toFixed(1)}% progress - $${candidate.distanceToGraduation.toFixed(0)} to go!`);
  }

  /**
   * Update token graduation data in database
   */
  private async updateTokenGraduationData(
    tokenAddress: string, 
    candidate: GraduationCandidate,
    tokensSold: number
  ): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          curve_progress: candidate.curveProgress,
          market_cap: candidate.marketCapUSD,
          price: candidate.currentPrice,
          distance_to_graduation: candidate.distanceToGraduation,
          estimated_graduation_time: candidate.estimatedTimeToGraduation 
            ? Math.round(candidate.estimatedTimeToGraduation * 100) / 100
            : null,
          tokens_sold: tokensSold, // Store tokens sold if column exists
          sol_price_at_update: solPriceService.getCurrentPrice(), // Store SOL price
          updated_at: new Date(),
        });

      // Store graduation tracking snapshot
      await db('pump_fun_curve_snapshots').insert({
        token_address: tokenAddress,
        created_at: new Date(),
        sol_reserves: candidate.currentSolReserves,
        curve_progress: candidate.curveProgress,
        price: candidate.currentPrice,
        distance_to_graduation: candidate.distanceToGraduation,
        market_cap_usd: candidate.marketCapUSD,
      });
    } catch (error: any) {
      logger.error('Error updating graduation data:', error);
      // If insert fails, try without created_at (it might have a default)
      if (error.code === '42703') {
        try {
          await db('pump_fun_curve_snapshots').insert({
            token_address: tokenAddress,
            sol_reserves: candidate.currentSolReserves,
            curve_progress: candidate.curveProgress,
            price: candidate.currentPrice,
            distance_to_graduation: candidate.distanceToGraduation,
            market_cap_usd: candidate.marketCapUSD,
            // created_at will use default value
          });
        } catch (retryError) {
          logger.error('Retry also failed:', retryError);
        }
      }
    }
  }
  
  /**
   * Get bonding curve address for a token
   */
  private async getBondingCurveAddress(tokenAddress: string): Promise<string | null> {
    const token = await db('tokens')
      .where('address', tokenAddress)
      .first();
    
    return token?.bonding_curve || null;
  }

  private async connectWebSocket(): Promise<void> {
    const wsUrl = config.discovery.pumpfunWsUrl || PUMP_FUN_CONSTANTS.PUMP_FUN_WS_URL;
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        logger.info('Connected to PumpFun WebSocket');
        
        // Correct subscription format - pump.fun wants 'keys' parameter
        this.ws?.send(JSON.stringify({
          method: 'subscribeNewToken',
          keys: [] // Empty array subscribes to all new tokens
        }));

        // Also subscribe to trades if needed
        this.ws?.send(JSON.stringify({
          method: 'subscribeTokenTrade',
          keys: [] // Empty array for all trades
        }));
        
        // Set up ping interval
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);
      });

      this.ws.on('message', async (data: Buffer) => {
        try {
          const messageStr = data.toString();
          const message = JSON.parse(messageStr);
          
          // Skip error messages
          if (message.errors) {
            return;
          }
          
          // Handle token creation - pump.fun uses txType: "create"
          if (message.txType === 'create' && message.mint) {
            logger.debug('New token creation detected:', {
              mint: message.mint,
              symbol: message.symbol,
              name: message.name,
              marketCapSol: message.marketCapSol
            });
            
            await this.handleNewToken(message);
          }
          
          // Handle token trades
          else if ((message.txType === 'buy' || message.txType === 'sell') && message.mint) {
            await this.handleTokenTrade(message);
          }
          
        } catch (error) {
          logger.error('Error processing WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });

      this.ws.on('close', () => {
        logger.info('WebSocket connection closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        
        // Attempt reconnection after delay
        if (this.isRunning) {
          setTimeout(() => this.connectWebSocket(), 5000);
        }
      });

    } catch (error) {
      logger.error('Failed to connect WebSocket:', error);
    }
  }

  /**
   * Handle new token from WebSocket
   */
  private async handleNewToken(message: any): Promise<void> {
    // pump.fun sends the token data directly in the message
    const tokenData = message;
    
    // Validate we have minimum required data
    if (!tokenData.mint) {
      logger.debug('No mint address in token data');
      return;
    }

    // pump.fun provides bondingCurveKey directly
    const bondingCurve = tokenData.bondingCurveKey;
    if (!bondingCurve) {
      logger.error('No bonding curve key in token data');
      return;
    }

    const enhancedToken: EnhancedTokenDiscovery = {
      address: tokenData.mint,
      symbol: tokenData.symbol || 'UNKNOWN',
      name: tokenData.name || `Token ${tokenData.mint.slice(0, 6)}`,
      platform: 'pumpfun',
      createdAt: new Date(),
      bondingCurve: bondingCurve,
      associatedBondingCurve: this.deriveAssociatedBondingCurve(tokenData.mint, bondingCurve),
      creator: tokenData.traderPublicKey, // The initial buyer is often the creator
      creatorVault: await this.deriveCreatorVault(tokenData.traderPublicKey),
      metadata: {
        description: '',
        imageUri: tokenData.uri,
        method: 'websocket',
        signature: tokenData.signature,
        initialBuy: tokenData.initialBuy,
        initialSolAmount: tokenData.solAmount,
        virtualSolReserves: tokenData.vSolInBondingCurve,
        virtualTokenReserves: tokenData.vTokensInBondingCurve,
        marketCapSol: tokenData.marketCapSol,
        pool: tokenData.pool,
      },
    };

    // Calculate initial price from the virtual reserves
    if (tokenData.vSolInBondingCurve && tokenData.vTokensInBondingCurve) {
      // Price = SOL reserves / token reserves (adjusted for decimals)
      enhancedToken.initialPrice = tokenData.vSolInBondingCurve / (tokenData.vTokensInBondingCurve / 1_000_000);
      enhancedToken.virtualSolReserves = tokenData.vSolInBondingCurve;
      enhancedToken.virtualTokenReserves = tokenData.vTokensInBondingCurve;
    }

    // Calculate market cap in USD using dynamic SOL price
    const solPriceUSD = solPriceService.getCurrentPrice();
    const marketCapUSD = (tokenData.marketCapSol || 0) * solPriceUSD;
    
    logger.info(`New PumpFun token: ${enhancedToken.symbol} (${enhancedToken.name}) - Market Cap: $${marketCapUSD.toFixed(0)}`);
    
    // Add to graduation tracking if it has decent market cap
    if (marketCapUSD > 1000) { // Track tokens >$1k market cap
      await this.addTokenToGraduationTracking({
        address: enhancedToken.address,
        symbol: enhancedToken.symbol,
        name: enhancedToken.name,
        bonding_curve: enhancedToken.bondingCurve,
        bondingCurveKey: enhancedToken.bondingCurve,
        marketCapSol: tokenData.marketCapSol,
      });
    }
    
    this.emitEnhancedTokenDiscovery(enhancedToken);
  }

  /**
   * Handle token trade from WebSocket
   */
  private async handleTokenTrade(message: any): Promise<void> {
    if (!message.mint || !this.trackedTokens.has(message.mint)) {
      return;
    }

    // Log trade activity
    logger.debug(`Trade activity on tracked token: ${message.mint}`, {
      type: message.txType,
      amount: message.solAmount,
      trader: message.traderPublicKey
    });
    
    // Force a graduation check for active tokens
    const candidate = this.trackedTokens.get(message.mint);
    if (candidate && candidate.marketCapUSD > 50000) { // >$50k market cap
      await this.checkGraduationCandidates();
    }
  }

  private deriveAssociatedBondingCurve(mint: string, bondingCurve: string): string {
    try {
      const mintPubkey = new PublicKey(mint);
      const bondingCurvePubkey = new PublicKey(bondingCurve);
      
      const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
      
      const [associatedAddress] = PublicKey.findProgramAddressSync(
        [
          bondingCurvePubkey.toBuffer(),
          TOKEN_PROGRAM.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM
      );
      
      return associatedAddress.toString();
    } catch (error) {
      logger.error('Error deriving associated bonding curve:', error);
      return bondingCurve; // Fallback
    }
  }

  private async deriveCreatorVault(creator: string): Promise<string> {
    try {
      const creatorPubkey = new PublicKey(creator);
      const [vaultPubkey] = await PublicKey.findProgramAddress(
        [
          Buffer.from('creator-vault'),
          creatorPubkey.toBuffer()
        ],
        this.PUMP_FUN_PROGRAM
      );
      return vaultPubkey.toString();
    } catch (error) {
      logger.error('Error deriving creator vault:', error);
      return creator; // Fallback
    }
  }

  protected emitEnhancedTokenDiscovery(token: EnhancedTokenDiscovery): void {
    // Filter out tokens without proper data
    if (!token.symbol || !token.name || 
        token.symbol === 'UNKNOWN' || 
        token.name.includes('Token ')) {
      logger.debug('Token has incomplete data but emitting anyway for tracking');
    }

    logger.info(`Enhanced token discovery: ${token.symbol} - Initial Price: ${token.initialPrice?.toFixed(8) || 'N/A'} SOL`);
    
    // Emit as regular TokenDiscovery for compatibility
    const basicToken: TokenDiscovery = {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      platform: token.platform,
      createdAt: token.createdAt,
      metadata: {
        ...token.metadata,
        bondingCurve: token.bondingCurve,
        associatedBondingCurve: token.associatedBondingCurve,
        creator: token.creator,
        creatorVault: token.creatorVault,
        initialPrice: token.initialPrice,
        initialLiquidity: token.initialLiquidity,
        curveProgress: token.curveProgress,
      },
    };

    this.emit('tokenDiscovered', basicToken);
    
    // Also emit enhanced version for components that can use it
    this.emit('enhancedTokenDiscovered', token);
  }

  /**
   * Get current graduation candidates
   */
  public getGraduationCandidates(minMarketCapUSD: number = 35000): GraduationCandidate[] {
    const candidates: GraduationCandidate[] = [];
    
    for (const candidate of this.trackedTokens.values()) {
      if (candidate.marketCapUSD >= minMarketCapUSD) {
        candidates.push(candidate);
      }
    }
    
    // Sort by market cap (closest to graduation first)
    return candidates.sort((a, b) => b.marketCapUSD - a.marketCapUSD);
  }

  protected async stopMonitoring(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.graduationCheckInterval) {
      clearInterval(this.graduationCheckInterval);
      this.graduationCheckInterval = null;
    }
  }
}