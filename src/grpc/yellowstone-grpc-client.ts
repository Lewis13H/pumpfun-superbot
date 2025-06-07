// src/grpc/yellowstone-grpc-client.ts - V2 with account subscriptions and better token detection

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { db } from '../database/postgres';

// Fix for bs58 - it exports as { default: { encode, decode } }
const bs58 = require('bs58').default;

// Use require for yellowstone-grpc
const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

// Pump.fun constants
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 43, 44, 206, 33, 208, 132, 4]);
const CREATE_DISCRIMINATORS = [24, 234];
const BUY_DISCRIMINATOR = 102;
const SELL_DISCRIMINATOR = 51;

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
  isComplete?: boolean;
  totalSupply?: number;
}

export interface TokenTransaction {
  signature: string;
  tokenAddress: string;
  timestamp: Date;
  type: 'create' | 'buy' | 'sell' | 'migrate';
  userAddress: string;
  tokenAmount: bigint;
  solAmount: bigint;
  priceUsd: number;
  priceSol: number;
  slot: number;
  fee: bigint;
  bondingCurve?: string;
}

interface BondingCurveAccount {
  discriminator: Buffer;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  tokenMint: string;
  bondingCurveAddress?: string;
  bumpSeed?: bigint;
  curveProgress?: number;
}

export class YellowstoneGrpcClient extends EventEmitter {
  private client: any;
  private stream: any;
  private config: Required<YellowstoneConfig>;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private solPriceUsd = 100;
  private bondingCurves: Map<string, string> = new Map(); // tokenMint -> bondingCurve
  private trackingTokens: Set<string> = new Set();
  private subscribedAccounts: Set<string> = new Set();
  
  constructor(config: YellowstoneConfig) {
    super();
    
    this.config = {
      commitment: 1, // CONFIRMED
      ...config
    };
    
    // Clean and ensure protocol
    const cleanEndpoint = this.config.endpoint.trim().replace(/['"]/g, '');
    const endpointWithProtocol = cleanEndpoint.includes('://') 
      ? cleanEndpoint 
      : `https://${cleanEndpoint}`;
    const cleanToken = this.config.token.trim().replace(/['"]/g, '');
    
    logger.info('Creating Yellowstone client:', {
      endpoint: endpointWithProtocol,
      tokenLength: cleanToken.length
    });
    
    try {
      // Create client directly without bridge
      this.client = new Client(endpointWithProtocol, cleanToken, undefined);
      logger.info('✅ Client created successfully');
    } catch (error) {
      logger.error('Failed to create client:', error);
      throw error;
    }
  }
  
  async connect(): Promise<void> {
    try {
      logger.info('🔌 Connecting to Yellowstone gRPC...');
      
      // Create new subscription
      this.stream = await this.client.subscribe();
      logger.info('✅ Subscribe call successful');
      
      // Set up stream handlers first
      this.setupStreamHandlers();
      
      // Then send subscription request
      await this.sendSubscriptionRequest();
      
      this.isConnected = true;
      
      logger.info('✅ Connected to Yellowstone gRPC');
      this.emit('connected');
      
    } catch (error) {
      logger.error('Failed to connect to gRPC:', error);
      
      // If initial connection fails, try to reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.handleReconnect();
      } else {
        throw error;
      }
    }
  }
  
  private setupStreamHandlers(): void {
    // Data handler
    this.stream.on('data', (data: any) => {
      // Don't process data if we're not connected
      if (!this.isConnected) return;
      
      this.handleStreamData(data).catch(error => {
        logger.error('Error handling stream data:', error);
        this.emit('error', error);
      });
    });
    
    // Error handler - following Shyft's pattern
    this.stream.on('error', (error: Error) => {
      logger.error('Stream error:', error);
      this.isConnected = false;
      this.emit('error', error);
      // Don't immediately disconnect - let the stream end naturally
    });
    
    // End handler
    this.stream.on('end', () => {
      logger.warn('Stream ended');
      this.isConnected = false;
      this.emit('disconnected');
      this.handleReconnect();
    });
    
    // Close handler
    this.stream.on('close', () => {
      logger.warn('Stream closed');
      this.isConnected = false;
      this.emit('disconnected');
      this.handleReconnect();
    });
  }
  
  private async handleReconnect(): Promise<void> {
    // Following Shyft's reconnect pattern
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      try {
        // Reset the stream
        this.stream = null;
        
        // Reconnect
        await this.connect();
        
        // Reset attempts on successful connection
        this.reconnectAttempts = 0;
      } catch (error) {
        logger.error('Reconnection failed:', error);
        // Will trigger another reconnect through the error/end handlers
      }
    }, delay);
  }
  
  private async sendSubscriptionRequest(): Promise<void> {
    // Subscribe to both transactions AND accounts
    const request = {
      accounts: {
        pumpBondingCurves: {
          account: [], // Will be populated dynamically
          owner: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
          filters: [{
            memcmp: {
              offset: 0,
              bytes: BONDING_CURVE_DISCRIMINATOR.toString('base64')
            }
          }]
        }
      },
      slots: {},
      transactions: {
        pumpFun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
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
      commitment: 1 // CommitmentLevel.CONFIRMED
    };

    logger.debug('Sending subscription request with account monitoring...');

    return new Promise<void>((resolve, reject) => {
      this.stream.write(request, (err: any) => {
        if (err) {
          logger.error('Write error:', err);
          reject(err);
        } else {
          logger.info('📡 Subscription sent successfully');
          resolve();
        }
      });
    });
  }
  
  private async handleStreamData(data: any): Promise<void> {
    try {
      // Add defensive check
      if (!data) return;
      
      // Handle different types of updates
      if (data.transaction) {
        await this.handleTransaction(data);
      }
      
      if (data.account) {
        await this.handleAccountUpdate(data.account);
      }
      
      // Handle ping - just log it, don't respond
      if (data.ping) {
        logger.debug('Received ping from server');
      }
      
      // Handle pong responses
      if (data.pong) {
        logger.debug('Received pong from server');
      }
      
    } catch (error) {
      logger.error('Error in handleStreamData:', error);
    }
  }
  
  private async handleTransaction(data: any): Promise<void> {
    try {
      const result = this.transformOutput(data);
      
      if (!result || !result.signature) {
        return;
      }
      
      // Check if this is a new token creation
      const isNewToken = result.logFilter;
      
      if (isNewToken) {
        // Look for pump token creation pattern
        const createdAccounts = this.extractCreatedAccounts(result);
        
        for (const account of createdAccounts) {
          // Only process pump tokens
          if (account.mint && account.mint.endsWith('pump')) {
            const tokenMint = account.mint;
            const bondingCurve = account.bondingCurve;
            const creator = result.message.accountKeys[0];
            
            // Skip if we're already tracking this token
            if (this.trackingTokens.has(tokenMint)) {
              logger.debug(`Already tracking token: ${tokenMint}`);
              continue;
            }
            
            const tokenTx: TokenTransaction = {
              signature: result.signature,
              tokenAddress: tokenMint,
              timestamp: new Date(),
              type: 'create',
              userAddress: creator,
              tokenAmount: 0n,
              solAmount: 0n,
              priceUsd: 0,
              priceSol: 0,
              slot: data.transaction?.slot || 0,
              fee: BigInt(result.meta?.fee || 0),
              bondingCurve: bondingCurve
            };
            
            // Track the token and its bonding curve
            this.trackingTokens.add(tokenMint);
            if (bondingCurve) {
              this.bondingCurves.set(tokenMint, bondingCurve);
              // We'll subscribe to this bonding curve dynamically later
            }
            
            this.emit('tokenCreated', tokenTx);
            
            logger.info(`🎉 New pump token created: ${tokenMint}`);
          }
        }
      } else {
        // Parse buy/sell transactions
        await this.parseTransaction(result, data.transaction?.slot || 0);
      }
      
    } catch (error) {
      logger.error('Error handling transaction:', error);
    }
  }
  
  private extractCreatedAccounts(result: any): Array<{mint?: string, bondingCurve?: string}> {
    const createdAccounts: Array<{mint?: string, bondingCurve?: string}> = [];
    
    try {
      // Check postTokenBalances for new token mints
      const postTokenBalances = result.meta?.postTokenBalances || [];
      const preTokenBalances = result.meta?.preTokenBalances || [];
      
      logger.debug(`Checking token balances - post: ${postTokenBalances.length}, pre: ${preTokenBalances.length}`);
      
      // Find new token accounts (exist in post but not in pre)
      for (const postBalance of postTokenBalances) {
        const isNew = !preTokenBalances.some((pre: any) => 
          pre.accountIndex === postBalance.accountIndex
        );
        
        if (isNew && postBalance.mint) {
          const mint = this.decodeBase58(postBalance.mint);
          
          logger.debug(`Found new token: ${mint}`);
          
          // Filter out system program and non-pump tokens
          if (!mint.startsWith(SYSTEM_PROGRAM) && 
              !mint.endsWith('11111111111111111111111112') &&
              mint.endsWith('pump')) {
            
            // Try to find bonding curve from the transaction
            const bondingCurve = this.findBondingCurveInTransaction(result);
            
            logger.debug(`Token ${mint} bonding curve: ${bondingCurve || 'not found'}`);
            
            createdAccounts.push({
              mint,
              bondingCurve
            });
          }
        }
      }
      
      // Also check logs for Create instruction with pump program
      const logs = result.meta?.logMessages || [];
      const hasPumpCreate = logs.some((log: string) => 
        log.includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke') &&
        logs.some((l: string) => l.includes('Instruction: Create'))
      );
      
      if (hasPumpCreate && createdAccounts.length === 0) {
        logger.debug('Found Create instruction but no token in postTokenBalances, checking account keys...');
        // Try to extract from account keys
        const accountKeys = result.message.accountKeys || [];
        for (const key of accountKeys) {
          if (key.endsWith('pump') && !this.trackingTokens.has(key)) {
            logger.debug(`Found pump token in account keys: ${key}`);
            createdAccounts.push({ mint: key });
          }
        }
      }
      
    } catch (error) {
      logger.error('Error extracting created accounts:', error);
    }
    
    logger.debug(`Extracted ${createdAccounts.length} created accounts`);
    return createdAccounts;
  }
  
  private findBondingCurveInTransaction(result: any): string | undefined {
    try {
      // Look for accounts owned by pump program in the transaction
      const accountKeys = result.message.accountKeys || [];
      
      // Bonding curves are usually created in the same transaction
      // Look for accounts that could be bonding curves
      for (let i = 0; i < accountKeys.length; i++) {
        const account = accountKeys[i];
        // Bonding curves have specific patterns, but without parsing the full tx data,
        // we'll need to wait for account updates to identify them
        if (account.length === 44 && !account.endsWith('pump') && !account.startsWith(SYSTEM_PROGRAM)) {
          // This could be a bonding curve - we'll verify when we get account updates
          return account;
        }
      }
    } catch (error) {
      logger.error('Error finding bonding curve:', error);
    }
    
    return undefined;
  }
  
  private transformOutput(data: any): any {
    try {
      const dataTx = data?.transaction?.transaction;
      const signature = dataTx?.signature ? this.decodeBase58(dataTx.signature) : "";
      const message = dataTx?.transaction?.message;
      const header = message?.header;
      
      const accountKeys = message?.accountKeys?.map((key: any) => {
        return this.decodeBase58(key);
      }) || [];
      
      const recentBlockhash = message?.recentBlockhash ? this.decodeBase58(message.recentBlockhash) : "";
      const instructions = message?.instructions || [];
      const meta = dataTx?.meta;
      
      // Check logs for token creation
      const logs: string[] = meta?.logMessages || [];
      const logFilter = logs.some(log => 
        log.includes('Instruction: Create') || 
        log.includes('MintTo') ||
        log.includes('InitializeMint')
      );
      
      return {
        signature,
        message: {
          header,
          accountKeys,
          recentBlockhash,
          instructions
        },
        meta,
        logFilter
      };
    } catch (error) {
      logger.error('Error transforming output:', error);
      return null;
    }
  }
  
  private decodeBase58(data: any): string {
    try {
      if (typeof data === 'string') {
        return data;
      }
      if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
        return bs58.encode(data);
      }
      if (Array.isArray(data)) {
        return bs58.encode(Buffer.from(data));
      }
      if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
        return bs58.encode(Buffer.from(data.data));
      }
      return '';
    } catch (error) {
      logger.error('Error decoding base58:', error);
      return '';
    }
  }
  
  private async parseTransaction(result: any, slot: number): Promise<void> {
    try {
      for (const instruction of result.message.instructions) {
        const programIdIndex = instruction.programIdIndex;
        const programId = result.message.accountKeys[programIdIndex];
        
        if (programId !== PUMP_FUN_PROGRAM) continue;
        
        const data = instruction.data;
        if (!data || data.length === 0) continue;
        
        const discriminator = data[0];
        
        if (discriminator === BUY_DISCRIMINATOR || discriminator === SELL_DISCRIMINATOR) {
          const type = discriminator === BUY_DISCRIMINATOR ? 'buy' : 'sell';
          const user = result.message.accountKeys[0];
          
          // Try to extract token address from the instruction accounts
          let tokenAddress = 'unknown';
          if (instruction.accounts && instruction.accounts.length > 0) {
            // Usually the token mint is one of the first accounts
            for (const accountIndex of instruction.accounts) {
              const account = result.message.accountKeys[accountIndex];
              if (account && account.endsWith('pump')) {
                tokenAddress = account;
                break;
              }
            }
          }
          
          const tokenTx: TokenTransaction = {
            signature: result.signature,
            tokenAddress,
            timestamp: new Date(),
            type,
            userAddress: user,
            tokenAmount: 0n,
            solAmount: 0n,
            priceUsd: 0,
            priceSol: 0,
            slot,
            fee: BigInt(result.meta?.fee || 0)
          };
          
          this.emit('transaction', tokenTx);
        }
      }
    } catch (error) {
      logger.error('Error parsing transaction:', error);
    }
  }
  
  private async handleAccountUpdate(account: any): Promise<void> {
    try {
      const accountKey = this.decodeBase58(account.account.pubkey);
      const owner = this.decodeBase58(account.account.owner);
      
      logger.debug(`Account update: ${accountKey} owned by ${owner}`);
      
      if (owner !== PUMP_FUN_PROGRAM) return;
      
      const data = Buffer.from(account.account.data);
      
      logger.debug(`Checking if account ${accountKey} is bonding curve (data length: ${data.length})`);
      
      if (!data.slice(0, 8).equals(BONDING_CURVE_DISCRIMINATOR)) {
        logger.debug(`Account ${accountKey} is not a bonding curve (discriminator mismatch)`);
        return;
      }
      
      const bondingCurve = this.parseBondingCurveAccount(data);
      
      if (!bondingCurve || !bondingCurve.tokenMint) {
        logger.debug(`Failed to parse bonding curve data for ${accountKey}`);
        return;
      }
      
      logger.info(`📈 Bonding curve update for token ${bondingCurve.tokenMint}`);
      
      // Update our mapping
      this.bondingCurves.set(bondingCurve.tokenMint, accountKey);
      
      const priceSol = this.calculatePrice(bondingCurve);
      const priceUsd = priceSol * this.solPriceUsd;
      
      const totalSupply = Number(bondingCurve.tokenTotalSupply) / 1e6;
      const marketCap = priceUsd * totalSupply;
      
      const solInCurve = Number(bondingCurve.realSolReserves) / 1e9;
      const liquidityUsd = solInCurve * this.solPriceUsd * 2;
      
      logger.debug(`Token ${bondingCurve.tokenMint} - Price: ${priceUsd.toFixed(6)}, MC: ${marketCap.toFixed(2)}, Progress: ${bondingCurve.curveProgress?.toFixed(2)}%`);
      
      const priceUpdate: TokenPrice = {
        tokenAddress: bondingCurve.tokenMint,
        timestamp: new Date(),
        priceUsd,
        priceSol,
        virtualSolReserves: bondingCurve.virtualSolReserves,
        virtualTokenReserves: bondingCurve.virtualTokenReserves,
        realSolReserves: bondingCurve.realSolReserves,
        realTokenReserves: bondingCurve.realTokenReserves,
        marketCap,
        liquidityUsd,
        slot: account.slot,
        curveProgress: bondingCurve.curveProgress,
        isComplete: bondingCurve.complete,
        totalSupply
      };
      
      this.emit('priceUpdate', priceUpdate);
      
      await this.updateTokenMetrics(bondingCurve.tokenMint, {
        currentPriceUsd: priceUsd,
        currentPriceSol: priceSol,
        marketCap,
        liquidity: solInCurve,
        curveProgress: bondingCurve.curveProgress,
        isGraduated: bondingCurve.complete,
        bondingCurve: accountKey
      });
      
      if (bondingCurve.curveProgress && bondingCurve.curveProgress > 80 && !bondingCurve.complete) {
        this.emit('nearGraduation', {
          tokenAddress: bondingCurve.tokenMint,
          progress: bondingCurve.curveProgress,
          solInCurve
        });
      }
      
    } catch (error) {
      logger.error('Error handling account update:', error);
    }
  }
  
  private parseBondingCurveAccount(data: Buffer): BondingCurveAccount | null {
    try {
      if (data.length < 121) return null;
      
      const account: BondingCurveAccount = {
        discriminator: data.slice(0, 8),
        virtualTokenReserves: data.readBigUInt64LE(8),
        virtualSolReserves: data.readBigUInt64LE(16),
        realTokenReserves: data.readBigUInt64LE(24),
        realSolReserves: data.readBigUInt64LE(32),
        tokenTotalSupply: data.readBigUInt64LE(40),
        complete: data.readUInt8(48) === 1,
        tokenMint: bs58.encode(data.slice(49, 81)),
        bondingCurveAddress: bs58.encode(data.slice(81, 113)),
        bumpSeed: data.readBigUInt64LE(113)
      };

      const realSolInLamports = Number(account.realSolReserves);
      const targetSolInLamports = 85 * 1e9;
      account.curveProgress = Math.min((realSolInLamports / targetSolInLamports) * 100, 100);

      return account;
    } catch (error) {
      logger.error('Error parsing bonding curve account:', error);
      return null;
    }
  }
  
  private calculatePrice(bondingCurve: BondingCurveAccount): number {
    if (bondingCurve.virtualTokenReserves === 0n) return 0;
    
    const solReserves = Number(bondingCurve.virtualSolReserves) / 1e9;
    const tokenReserves = Number(bondingCurve.virtualTokenReserves) / 1e6;
    
    const price = solReserves / tokenReserves;
    
    if (price < 0 || price > 1000000) {
      logger.warn(`Unusual price calculated: ${price}`);
      return 0;
    }
    
    return price;
  }
  
  private async updateTokenMetrics(tokenAddress: string, metrics: any): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          current_price_usd: metrics.currentPriceUsd,
          current_price_sol: metrics.currentPriceSol,
          market_cap: metrics.marketCap,
          liquidity: metrics.liquidity,
          curve_progress: metrics.curveProgress,
          is_graduated: metrics.isGraduated,
          bonding_curve: metrics.bondingCurve,
          last_price_update: new Date(),
          updated_at: new Date()
        });
    } catch (error) {
      logger.error('Error updating token metrics:', error);
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    this.isConnected = false;
    this.bondingCurves.clear();
    this.trackingTokens.clear();
    this.subscribedAccounts.clear();
    
    logger.info('Disconnected from gRPC');
  }
  
  isActive(): boolean {
    return this.isConnected;
  }
  
  setSolPrice(price: number): void {
    this.solPriceUsd = price;
    logger.debug(`SOL price updated to $${price}`);
  }
  
  async subscribeToBondingCurve(bondingCurveAddress: string): Promise<void> {
    if (!this.stream || !this.isConnected) {
      logger.warn('Cannot subscribe to bonding curve - not connected');
      return;
    }
    
    // For now, we're already subscribing to all pump-owned accounts
    // In the future, we could dynamically update subscriptions
    logger.debug(`Tracking bonding curve: ${bondingCurveAddress}`);
    this.subscribedAccounts.add(bondingCurveAddress);
  }
  
  getBondingCurveForToken(tokenAddress: string): string | undefined {
    return this.bondingCurves.get(tokenAddress);
  }
}