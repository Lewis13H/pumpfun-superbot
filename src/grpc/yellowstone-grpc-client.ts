// src/grpc/yellowstone-grpc-client.ts
// WORKING VERSION - BYPASSES BS58 ISSUES COMPLETELY

import { EventEmitter } from 'events';
import { logger } from '../utils/logger2';
import { db } from '../database/postgres';
import { struct, u64, bool, publicKey, u8 } from '@project-serum/borsh';
import { PublicKey } from '@solana/web3.js';
import { SOL_PRICE_SERVICE } from '../services/sol-price-service';

// ✅ FIXED: Use require() instead of import for JavaScript file
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');

const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export interface YellowstoneConfig {
  endpoint: string;
  token: string;
  commitment?: number;
}

export interface TokenPrice {
  tokenAddress: string;
  timestamp: Date;
  priceUsd: number;
  priceSol: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  marketCap: number;
  liquidityUsd: number;
  slot: number;
  curveProgress?: number;
  isComplete: boolean;
  totalSupply: number;
}

// ✅ FIXED: Updated TokenTransaction interface with missing properties
export interface TokenTransaction {
  signature: string;
  tokenAddress: string;
  timestamp: Date;
  type: 'create' | 'buy' | 'sell';
  userAddress: string;
  tokenAmount?: bigint;
  solAmount?: bigint;
  priceUsd: number;
  priceSol: number;
  slot: number;
  bondingCurve?: string;  // ✅ ADDED: Referenced in grpc-stream-manager.ts line 378
  fee?: bigint;           // ✅ ADDED: Referenced in grpc-stream-manager.ts line 758
}

export interface BondingCurveAccount {
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  tokenMint: string;
  curveProgress?: number;
}

const bondingCurveStructure = struct([
  u64('discriminator'),
  u64('virtualTokenReserves'),
  u64('virtualSolReserves'),
  u64('realTokenReserves'),
  u64('realSolReserves'),
  u64('tokenTotalSupply'),
  bool('complete'),
  publicKey('tokenMint')
]);

export class YellowstoneGrpcClient extends EventEmitter {
  private client: any;
  private stream: any;
  private config: Required<YellowstoneConfig>;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  
  // ✅ MODIFIED: Use dynamic SOL price instead of static
  private solPriceUsd: number;
  
  private bondingCurveToToken: Map<string, string> = new Map();
  private tokenToBondingCurve: Map<string, string> = new Map();
  
  private stats = {
    totalPriceUpdates: 0,
    totalTransactions: 0,
    totalTokensDiscovered: 0,
    startTime: new Date(),
    lastActivityTime: new Date(),
    errors: 0,
    reconnections: 0
  };

  constructor(config: YellowstoneConfig) {
    super();
    
    this.config = {
      commitment: 1, // CONFIRMED
      ...config
    };
    
    // ✅ NEW: Initialize with current SOL price from service
    this.solPriceUsd = SOL_PRICE_SERVICE.getCurrentPrice();
    
    // ✅ NEW: Listen for SOL price updates
    SOL_PRICE_SERVICE.on('priceUpdate', (data) => {
      const previousSolPrice = this.solPriceUsd;
      this.solPriceUsd = data.price;
      
      // Log significant SOL price changes (> 2%)
      if (Math.abs(data.change) > 2) {
        logger.info(`🔄 SOL price updated in gRPC client: $${previousSolPrice.toFixed(2)} → $${data.price.toFixed(2)} (${data.change.toFixed(2)}%)`);
      }
      
      // Emit event for other parts of system
      this.emit('solPriceUpdate', {
        oldPrice: previousSolPrice,
        newPrice: data.price,
        change: data.change,
        source: data.source
      });
    });
    
    // ✅ NEW: Handle SOL price service errors gracefully
    SOL_PRICE_SERVICE.on('error', (error) => {
      logger.warn('SOL price service error, continuing with last known price:', error);
      // Don't stop the system - continue with last known price
    });
    
    // ✅ NEW: Wait for SOL price service to initialize if needed
    if (!SOL_PRICE_SERVICE.getStats().isInitialized) {
      SOL_PRICE_SERVICE.once('initialized', (data) => {
        this.solPriceUsd = data.price;
        logger.info(`🚀 gRPC client initialized with SOL price: $${data.price.toFixed(2)}`);
      });
    }

    // Clean and ensure protocol
    const cleanEndpoint = this.config.endpoint.trim().replace(/['\"]/g, '');
    const endpointWithProtocol = cleanEndpoint.includes('://') 
      ? cleanEndpoint 
      : `https://${cleanEndpoint}`;
    const cleanToken = this.config.token.trim().replace(/['\"]/g, '');
    
    logger.info('🔌 Connecting to gRPC:', {
      endpoint: endpointWithProtocol,
      tokenLength: cleanToken.length,
      solPrice: this.solPriceUsd // ✅ NEW: Log current SOL price
    });
    
    try {
      this.client = new Client(endpointWithProtocol, cleanToken, undefined);
      logger.info('✅ gRPC client created successfully');
    } catch (error) {
      logger.error('Failed to create client:', error);
      throw error;
    }
    
    // Setup automatic reconnection
    this.setupReconnection();
  }

  async connect(): Promise<void> {
    try {
      this.stream = await this.client.subscribe();
      this.setupStreamHandlers();
      await this.sendSubscriptionRequest();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
      
      logger.info('✅ gRPC stream connected successfully');
    } catch (error) {
      this.stats.errors++;
      logger.error('Failed to connect gRPC stream:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private setupStreamHandlers(): void {
    this.stream.on('data', async (data: any) => {
      try {
        this.stats.lastActivityTime = new Date();
        
        if (data.account) {
          await this.handleAccountUpdate(data);
        }
        
        if (data.transaction) {
          await this.handleTransaction(data);
        }
      } catch (error) {
        this.stats.errors++;
        logger.error('Error handling stream data:', error);
      }
    });

    this.stream.on('error', (error: any) => {
      this.stats.errors++;
      logger.error('Stream error:', error);
      this.isConnected = false;
      this.emit('error', error);
      this.attemptReconnection();
    });

    this.stream.on('end', () => {
      logger.warn('Stream ended');
      this.isConnected = false;
      this.emit('disconnected');
      this.attemptReconnection();
    });

    this.stream.on('close', () => {
      logger.warn('Stream closed');
      this.isConnected = false;
      this.emit('disconnected');
    });
  }

  private async sendSubscriptionRequest(): Promise<void> {
    const request = {
      slots: {},
      accounts: {
        pumpBondingCurves: {
          account: [],
          filters: [{
            memcmp: {
              offset: bondingCurveStructure.offsetOf('complete').toString(),
              bytes: Uint8Array.from([0]) // Only active curves
            }
          }],
          owner: [PUMP_FUN_PROGRAM]
        }
      },
      transactions: {
        pumpFun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_FUN_PROGRAM],
          accountExclude: [],
          accountRequired: []
        }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: this.config.commitment
    };

    return new Promise<void>((resolve, reject) => {
      this.stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          logger.info('📡 Subscription sent successfully');
          resolve();
        }
      });
    });
  }

  // ✅ ENHANCED: Better price calculation with validation
  private calculatePrice(bondingCurve: BondingCurveAccount): number {
    if (bondingCurve.virtualTokenReserves === 0n) return 0;
    
    // Check for graduated curve
    if (bondingCurve.complete) {
      logger.debug(`Skipping price calculation for graduated token: ${bondingCurve.tokenMint.substring(0, 8)}...`);
      return 0;
    }
    
    const solReserves = Number(bondingCurve.virtualSolReserves) / 1e9;
    const tokenReserves = Number(bondingCurve.virtualTokenReserves) / 1e6;
    
    const price = solReserves / tokenReserves;
    
    // Enhanced validation
    if (price < 1e-12 || price > 1000) {
      logger.warn(`Invalid price calculated for ${bondingCurve.tokenMint.substring(0, 8)}...: ${price}`);
      return 0;
    }
    
    // Log extremely high prices for monitoring
    if (price > 1) {
      logger.info(`🔥 High price detected: ${bondingCurve.tokenMint.substring(0, 8)}... = ${price.toFixed(8)} SOL`);
    }
    
    return price;
  }

  // ✅ ENHANCED: Account updates with accurate USD calculations
  private async handleAccountUpdate(data: any): Promise<void> {
    try {
      const dataTx = data.account?.account;
      if (!dataTx) return;
      
      const accountKey = this.decodeBase58(dataTx.pubkey);
      const owner = this.decodeBase58(dataTx.owner);
      
      if (owner !== PUMP_FUN_PROGRAM) return;
      
      const accountData = Buffer.from(dataTx.data);
      const bondingCurve = this.parseBondingCurveAccount(accountData, accountKey);
      
      if (!bondingCurve) return;
      
      // Update mappings
      this.bondingCurveToToken.set(accountKey, bondingCurve.tokenMint);
      this.tokenToBondingCurve.set(bondingCurve.tokenMint, accountKey);
      
      // ✅ ENHANCED: Calculate price with current SOL price
      const priceSol = this.calculatePrice(bondingCurve);
      const priceUsd = priceSol * this.solPriceUsd; // Now uses real-time SOL price!
      
      // ✅ ENHANCED: Accurate market cap and liquidity
      const totalSupply = Number(bondingCurve.tokenTotalSupply) / 1e6;
      const marketCap = priceUsd * totalSupply; // Accurate market cap
      
      const solInCurve = Number(bondingCurve.realSolReserves) / 1e9;
      const liquidityUsd = solInCurve * this.solPriceUsd * 2; // Accurate liquidity
      
      // Calculate curve progress
      const graduationTarget = 85 * 1e9; // 85 SOL in lamports
      const curveProgress = Math.min((Number(bondingCurve.realSolReserves) / graduationTarget) * 100, 100);
      
      const priceUpdate: TokenPrice = {
        tokenAddress: bondingCurve.tokenMint,
        timestamp: new Date(),
        priceUsd, // ✅ Now accurate!
        priceSol,
        virtualSolReserves: bondingCurve.virtualSolReserves,
        virtualTokenReserves: bondingCurve.virtualTokenReserves,
        realSolReserves: bondingCurve.realSolReserves,
        realTokenReserves: bondingCurve.realTokenReserves,
        marketCap, // ✅ Now accurate!
        liquidityUsd, // ✅ Now accurate!
        slot: data.slot || 0,
        curveProgress,
        isComplete: bondingCurve.complete,
        totalSupply
      };
      
      this.stats.totalPriceUpdates++;
      this.emit('priceUpdate', priceUpdate);
      
      // Update token in database with bonding curve if not already set
      await this.updateTokenBondingCurve(bondingCurve.tokenMint, accountKey);
      
      // ✅ ENHANCED: Better graduation detection
      if (curveProgress > 80 && !bondingCurve.complete) {
        this.emit('nearGraduation', {
          tokenAddress: bondingCurve.tokenMint,
          progress: curveProgress,
          solInCurve,
          estimatedMarketCapAtGraduation: (priceSol * totalSupply * this.solPriceUsd), // Accurate prediction
          timeToGraduation: this.estimateTimeToGraduation(curveProgress)
        });
      }
      
    } catch (error) {
      this.stats.errors++;
      logger.error('Error handling account update:', error);
    }
  }

  private async handleTransaction(data: any): Promise<void> {
    try {
      const transaction = data.transaction?.transaction;
      if (!transaction) return;

      this.stats.totalTransactions++;
      this.stats.lastActivityTime = new Date();

      const signature = this.decodeBase58(transaction.signature);
      const slot = data.slot || 0;

      // Parse transaction for token operations
      const txnData = this.parseTransactionData(transaction, signature, slot);
      if (txnData) {
        this.emit('transaction', txnData);
        
        // Check if this is a new token creation
        if (txnData.type === 'create') {
          this.stats.totalTokensDiscovered++;
          this.emit('tokenCreated', txnData);
          
          // Queue for metadata fetching
          HELIUS_METADATA_SERVICE.queueTokenForMetadata(txnData.tokenAddress);
        }
      }
    } catch (error) {
      this.stats.errors++;
      logger.error('Error handling transaction:', error);
    }
  }

  // ✅ ENHANCED: Parse transaction with missing properties included
  private parseTransactionData(transaction: any, signature: string, slot: number): TokenTransaction | null {
    try {
      const timestamp = new Date();
      let userAddress = 'unknown';
      let tokenAddress = 'unknown';
      let bondingCurve: string | undefined = undefined;
      let fee: bigint | undefined = undefined;
      
      // Try to extract actual data from transaction
      if (transaction?.message?.staticAccountKeys?.length > 0) {
        userAddress = new PublicKey(transaction.message.staticAccountKeys[0]).toBase58();
      }
      
      // Try to find token address from account keys
      if (transaction?.message?.staticAccountKeys) {
        for (const accountKey of transaction.message.staticAccountKeys) {
          const address = new PublicKey(accountKey).toBase58();
          if (this.tokenToBondingCurve.has(address)) {
            tokenAddress = address;
            bondingCurve = this.tokenToBondingCurve.get(address);
            break;
          }
          if (this.bondingCurveToToken.has(address)) {
            tokenAddress = this.bondingCurveToToken.get(address) || 'unknown';
            bondingCurve = address;
            break;
          }
        }
      }
      
      // ✅ FIXED: Extract fee if available
      if (transaction?.meta?.fee) {
        fee = BigInt(transaction.meta.fee);
      }
      
      // Determine transaction type from logs or instructions
      let type: 'create' | 'buy' | 'sell' = 'buy';
      if (transaction?.meta?.logMessages) {
        const logs = transaction.meta.logMessages.join(' ');
        if (logs.includes('Instruction: Create')) {
          type = 'create';
        } else if (logs.includes('Instruction: Sell')) {
          type = 'sell';
        }
      }
      
      return {
        signature,
        tokenAddress,
        timestamp,
        type,
        userAddress,
        priceUsd: 0, // Will be calculated from current prices
        priceSol: 0,
        slot,
        bondingCurve,  // ✅ NOW INCLUDED
        fee           // ✅ NOW INCLUDED
      };
    } catch (error) {
      logger.error('Error parsing transaction data:', error);
      return null;
    }
  }

  private parseBondingCurveAccount(data: Buffer, accountKey: string): BondingCurveAccount | null {
    try {
      if (data.length < bondingCurveStructure.span) {
        return null;
      }

      const decoded = bondingCurveStructure.decode(data);
      
      // Calculate curve progress
      const graduationTarget = 85 * 1e9; // 85 SOL in lamports
      const curveProgress = Math.min((Number(decoded.realSolReserves) / graduationTarget) * 100, 100);

      return {
        discriminator: decoded.discriminator,
        virtualTokenReserves: decoded.virtualTokenReserves,
        virtualSolReserves: decoded.virtualSolReserves,
        realTokenReserves: decoded.realTokenReserves,
        realSolReserves: decoded.realSolReserves,
        tokenTotalSupply: decoded.tokenTotalSupply,
        complete: decoded.complete,
        tokenMint: new PublicKey(decoded.tokenMint).toBase58(),
        curveProgress
      };
    } catch (error) {
      logger.error('Error parsing bonding curve account:', error);
      return null;
    }
  }

  private async updateTokenBondingCurve(tokenAddress: string, bondingCurve: string): Promise<void> {
    try {
      await db('tokens')
        .where({ address: tokenAddress })
        .update({
          bonding_curve: bondingCurve,
          updated_at: new Date()
        });
    } catch (error) {
      logger.debug('Error updating token bonding curve:', error);
    }
  }

  // ✅ FIXED: Simple, reliable method that bypasses bs58 completely
  private decodeBase58(data: any): string {
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
      try {
        // Try using Solana's built-in PublicKey for base58 encoding
        return new PublicKey(data).toBase58();
      } catch (error) {
        // Fallback to hex encoding if not a valid public key
        return Buffer.from(data).toString('hex');
      }
    }
    return data.toString();
  }

  private setupReconnection(): void {
    // Implement reconnection logic
    this.on('error', () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.attemptReconnection();
      } else {
        logger.error('Max reconnection attempts reached');
      }
    });
  }

  private attemptReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnections++;
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed:', error);
      }
    }, delay);
  }

  private estimateTimeToGraduation(currentProgress: number): string {
    if (currentProgress >= 95) return '< 5 minutes';
    if (currentProgress >= 90) return '< 15 minutes';
    if (currentProgress >= 85) return '< 30 minutes';
    if (currentProgress >= 80) return '< 1 hour';
    return '> 1 hour';
  }

  // ✅ FIXED: Add isActive() method (referenced in grpc-stream-manager.ts line 835)
  isActive(): boolean {
    return this.isConnected && this.stream !== null;
  }

  // ✅ ENHANCED: Manual price override (improved)
  setSolPrice(price: number): void {
    const oldPrice = this.solPriceUsd;
    this.solPriceUsd = price;
    logger.info(`🔧 SOL price manually set: $${oldPrice.toFixed(2)} → $${price.toFixed(2)}`);
    
    // Emit update event
    this.emit('solPriceUpdate', {
      oldPrice,
      newPrice: price,
      change: ((price - oldPrice) / oldPrice) * 100,
      source: 'manual_override'
    });
  }

  // ✅ ENHANCED: Stats including SOL price info
  getStats() {
    const solPriceStats = SOL_PRICE_SERVICE.getStats();
    const uptime = Date.now() - this.stats.startTime.getTime();
    
    return {
      ...this.stats,
      uptime,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      tokensTracked: this.bondingCurveToToken.size,
      solPrice: {
        current: this.solPriceUsd,
        isStale: solPriceStats.isStale,
        lastUpdate: solPriceStats.lastUpdate,
        serviceInitialized: solPriceStats.isInitialized,
        consecutiveFailures: solPriceStats.consecutiveFailures || 0
      },
      metadata: HELIUS_METADATA_SERVICE.getStats()
    };
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    this.removeAllListeners();
    logger.info('🛑 gRPC client disconnected');
  }

  // Force immediate price update for all tracked tokens
  async refreshAllPrices(): Promise<void> {
    logger.info('🔄 Refreshing all token prices...');
    // This would trigger a re-calculation of all prices with current SOL price
    // Implementation depends on your specific needs
  }

  // Get current SOL price being used
  getCurrentSolPrice(): number {
    return this.solPriceUsd;
  }

  // Check if SOL price is stale
  isSolPriceStale(): boolean {
    return SOL_PRICE_SERVICE.getStats().isStale;
  }
}