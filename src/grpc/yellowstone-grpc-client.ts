// src/grpc/yellowstone-grpc-client.ts - FINAL VERSION WITH SHYFT METADATA

import { EventEmitter } from 'events';
import { logger } from '../utils/logger2';
import { db } from '../database/postgres';
import { struct, bool, u64, u8, publicKey } from '@coral-xyz/borsh';
import { PublicKey } from '@solana/web3.js';
// Import Helius metadata service
const { HELIUS_METADATA_SERVICE } = require('../services/multi-source-metadata-service');
//const { db } = require('../database/postgres-js');

// Fix for bs58
const bs58 = require('bs58').default;

// Use require for yellowstone-grpc
const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

// Pump.fun constants
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const MIGRATION_AUTHORITY = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 43, 44, 206, 33, 208, 132, 4]);
const CREATE_DISCRIMINATORS = [181, 234]; // 0xb5 = 181, 0xea = 234  
const BUY_DISCRIMINATOR = 102; // 0x66
const SELL_DISCRIMINATOR = 51; // 0x33

// Bonding curve structure based on Shyft example
const bondingCurveStructure = struct([
  u64("discriminator"),
  u64("virtualTokenReserves"),
  u64("virtualSolReserves"),
  u64("realTokenReserves"),
  u64("realSolReserves"),
  u64("tokenTotalSupply"),
  bool("complete"),
  publicKey("tokenMint")
]);

// Export interfaces
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
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  tokenMint: string;
  bondingCurveAddress: string;
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
  private bondingCurveToToken: Map<string, string> = new Map(); // bondingCurve -> tokenMint
  private tokenToBondingCurve: Map<string, string> = new Map(); // tokenMint -> bondingCurve
  
  // Simplified stats (removed complex metadata tracking)
  private stats = {
    transactionsProcessed: 0,
    createTransactions: 0,
    accountUpdates: 0,
    errors: 0
  }
  
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
    
    logger.info('🔌 Connecting to gRPC:', {
      endpoint: endpointWithProtocol,
      tokenLength: cleanToken.length
    });
    
    try {
      this.client = new Client(endpointWithProtocol, cleanToken, undefined);
      logger.info('✅ gRPC client created successfully');
    } catch (error) {
      logger.error('Failed to create client:', error);
      throw error;
    }
    
    // Log stats every 5 minutes
    setInterval(() => {
      const shyftStats = HELIUS_METADATA_SERVICE.getStats();
      logger.info('📊 CLIENT STATS:', {
        '🎉 New Tokens': this.stats.createTransactions,
        '📈 Price Updates': this.stats.accountUpdates,
        '💰 Transactions': this.stats.transactionsProcessed,
        '❌ Errors': this.stats.errors,
        '📝 Metadata Queue': shyftStats.processingQueue,
        '🔄 Metadata Retries': shyftStats.retryQueue
      });
    }, 300000); // Every 5 minutes
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
      this.reconnectAttempts = 0;
      
      logger.info('✅ Connected to Yellowstone gRPC');
      this.emit('connected');
      
    } catch (error) {
      logger.error('Failed to connect to gRPC:', error);
      
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
      if (!this.isConnected) return;
      
      this.handleStreamData(data).catch(error => {
        logger.error('Error handling stream data:', error);
        this.emit('error', error);
      });
    });
    
    // Error handler
    this.stream.on('error', (error: Error) => {
      logger.error('Stream error:', error);
      this.isConnected = false;
      this.emit('error', error);
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
        this.stream = null;
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed:', error);
      }
    }, delay);
  }
  
  private async sendSubscriptionRequest(): Promise<void> {
    // Subscribe to both transactions AND accounts (following Shyft example)
    const request = {
      slots: {},
      accounts: {
        // Subscribe to all Pump bonding curve accounts
        pumpBondingCurves: {
          account: [],
          filters: [{
            memcmp: {
              offset: bondingCurveStructure.offsetOf('complete').toString(),
              bytes: Uint8Array.from([0]) // Filter for complete = false
            }
          }],
          owner: [PUMP_FUN_PROGRAM]
        }
      },
      transactions: {
        // Pump.fun transactions
        pumpFun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [PUMP_FUN_PROGRAM],
          accountExclude: [],
          accountRequired: []
        },
        // Migration transactions
        migration: {
          vote: false,
          failed: false,
          accountInclude: [MIGRATION_AUTHORITY],
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

    logger.debug('Sending subscription request...');

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
      if (!data) return;
      
      // Handle account updates (bonding curves)
      if (data.account) {
        this.stats.accountUpdates++;
        await this.handleAccountUpdate(data);
      }
      
      // Handle transactions
      if (data.transaction) {
        this.stats.transactionsProcessed++;
        await this.handleTransaction(data);
      }
      
      // Handle ping
      if (data.ping) {
        logger.debug('Received ping from server');
      }
      
      // Handle pong
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
      
      // Check for migration
      if (this.isMigrationTransaction(result)) {
        await this.handleMigrationTransaction(result, data.transaction?.slot || 0);
        return;
      }
      
      // Parse transaction to detect token creation
      const logs = result.meta?.logMessages || [];
      
      // Enhanced create detection
      const hasCreateLog = logs.some((log: string) => 
        log.includes('Program log: Instruction: Create') && 
        log.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P') // Must be from Pump.fun program
      ) || logs.some((log: string) => 
        log.includes('InitializeMint') &&
        !log.includes('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Not just associated token creation
      );
      
      // ALSO check for actual Pump.fun CREATE instructions in the transaction data
      const hasPumpFunCreateInstruction = result.message?.instructions?.some((instruction: any) => {
        const programId = result.message.accountKeys[instruction.programIdIndex];
        if (programId !== PUMP_FUN_PROGRAM) return false;
        
        const data = Buffer.from(instruction.data);
        const discriminator = data[0];
        return CREATE_DISCRIMINATORS.includes(discriminator);
      }) || false;
      
      const hasCreate = hasCreateLog || hasPumpFunCreateInstruction;
      
      if (hasCreate) {
        this.stats.createTransactions++;
        
        logger.info(`🎉 Token creation detected: ${result.signature.substring(0, 8)}...`);
        
        // SIMPLIFIED: Extract token address and queue for Shyft metadata
        await this.extractTokenAndQueueMetadata(result, data.transaction?.slot || 0);
      } else {
        // Parse buy/sell transactions
        await this.parseTransaction(result, data.transaction?.slot || 0);
      }
      
    } catch (error) {
      logger.error('Error handling transaction:', error);
    }
  }
  
  // SIMPLIFIED: Extract token address and delegate metadata to Shyft API
  private async extractTokenAndQueueMetadata(result: any, slot: number): Promise<void> {
    try {
      const signature = result.signature;
      const accountKeys = result.message.accountKeys || [];
      
      // Find the token mint and bonding curve
      let tokenMint = '';
      let bondingCurve = '';
      
      // Method 1: Check post token balances for new mints
      const postTokenBalances = result.meta?.postTokenBalances || [];
      const preTokenBalances = result.meta?.preTokenBalances || [];
      
      for (const postBalance of postTokenBalances) {
        const isNew = !preTokenBalances.some((pre: any) => 
          pre.accountIndex === postBalance.accountIndex
        );
        
        if (isNew && postBalance.mint) {
          tokenMint = this.decodeBase58(postBalance.mint);
          logger.info(`✅ Found token mint: ${tokenMint.substring(0, 8)}...`);
          break;
        }
      }
      
      // Method 2: Parse instruction accounts if no mint found
      if (!tokenMint) {
        for (let instIndex = 0; instIndex < (result.message?.instructions || []).length; instIndex++) {
          const instruction = result.message.instructions[instIndex];
          const programId = result.message.accountKeys[instruction.programIdIndex];
          
          if (programId !== PUMP_FUN_PROGRAM) continue;
          
          const data = Buffer.from(instruction.data);
          const discriminator = data[0];
          
          if (CREATE_DISCRIMINATORS.includes(discriminator)) {
            if (instruction.accounts && instruction.accounts.length > 0) {
              for (let i = 0; i < instruction.accounts.length; i++) {
                const accountIndex = instruction.accounts[i];
                const account = accountKeys[accountIndex];
                
                if (account && 
                    !account.startsWith('1111111') && 
                    account !== PUMP_FUN_PROGRAM &&
                    account.length === 44) {
                  
                  // Try this as token mint
                  tokenMint = account;
                  logger.info(`✅ Found token mint from instruction: ${tokenMint.substring(0, 8)}...`);
                  break;
                }
              }
              
              // Find bonding curve (usually index 4)
              if (instruction.accounts.length > 4) {
                const bondingCurveIndex = instruction.accounts[4];
                bondingCurve = accountKeys[bondingCurveIndex] || '';
              }
            }
            break;
          }
        }
      }
      
      if (!tokenMint) {
        logger.error(`❌ CRITICAL: Could not find token mint in transaction ${signature.substring(0, 8)}...`);
        return;
      }
      
      // Store mappings
      if (bondingCurve) {
        this.bondingCurveToToken.set(bondingCurve, tokenMint);
        this.tokenToBondingCurve.set(tokenMint, bondingCurve);
      }
      
      // Check if token exists before emitting creation event
      const tokenExists = await db('tokens').where('address', tokenMint).first();
      
      if (!tokenExists) {
        // Create token with placeholder metadata
        await db('tokens')
          .insert({
            address: tokenMint,
            symbol: 'LOADING...',
            name: 'Loading...',
            category: 'NEW',
            bonding_curve: bondingCurve || null,
            created_at: new Date(),
            discovery_signature: result.signature,
            discovery_slot: slot
          })
          .onConflict('address')
          .ignore();
        
        // QUEUE FOR SHYFT METADATA FETCH
        HELIUS_METADATA_SERVICE.queueTokenForMetadata(tokenMint);
        
        logger.info(`🚀 NEW TOKEN QUEUED: ${tokenMint.substring(0, 8)}... → Metadata fetching...`);
        
        // Subscribe to bonding curve
        if (bondingCurve && this.isActive()) {
          await this.subscribeToBondingCurve(bondingCurve);
        }
        
        const tokenTx: TokenTransaction = {
          signature: result.signature,
          tokenAddress: tokenMint,
          timestamp: new Date(),
          type: 'create',
          userAddress: accountKeys[0] || '',
          tokenAmount: 0n,
          solAmount: 0n,
          priceUsd: 0,
          priceSol: 0,
          slot,
          fee: BigInt(result.meta?.fee || 0),
          bondingCurve
        };
        
        this.emit('tokenCreated', tokenTx); // Triggers handleNewToken()
        this.emit('transaction', tokenTx);   // 🔧 ADD THIS LINE - Triggers handleTransaction()
      }
      
    } catch (error: any) {
      logger.error('Error in simplified metadata extraction:', error?.message);
      this.stats.errors++;
    }
  }
  
  private isMigrationTransaction(result: any): boolean {
    const logs = result.meta?.logMessages || [];
    return logs.some((log: string) => 
      log.includes('initialize2') || 
      log.includes('Program log: Instruction: Migrate')
    );
  }
  
  private async handleMigrationTransaction(result: any, slot: number): Promise<void> {
    // Extract token mint from the transaction
    let tokenMint = '';
    let raydiumPool = '';
    
    // Look for the mint in post token balances
    const postTokenBalances = result.meta?.postTokenBalances || [];
    if (postTokenBalances.length > 0) {
      tokenMint = postTokenBalances[0].mint;
    }
    
    // The pool address is typically in the account keys
    const accountKeys = result.message.accountKeys || [];
    for (const key of accountKeys) {
      if (key.startsWith('5') || key.startsWith('6')) { // Common Raydium pool prefixes
        raydiumPool = key;
        break;
      }
    }
    
    if (tokenMint) {
      this.emit('tokenGraduated', {
        signature: result.signature,
        tokenAddress: tokenMint,
        raydiumPool,
        timestamp: new Date(),
        slot
      });
      
      logger.info(`🎓 Token graduated to Raydium: ${tokenMint.substring(0, 8)}...`);
    }
  }
  
  private async handleAccountUpdate(data: any): Promise<void> {
    try {
      const dataTx = data.account?.account;
      if (!dataTx) return;
      
      // Decode the account key and owner
      const accountKey = this.decodeBase58(dataTx.pubkey);
      const owner = this.decodeBase58(dataTx.owner);
      
      // Verify this is a Pump.fun account
      if (owner !== PUMP_FUN_PROGRAM) return;
      
      // Decode the account data
      const accountData = Buffer.from(dataTx.data);
      
      // Parse bonding curve data
      const bondingCurve = this.parseBondingCurveAccount(accountData, accountKey);
      
      if (!bondingCurve) {
        return;
      }
      
      // Update our mappings
      this.bondingCurveToToken.set(accountKey, bondingCurve.tokenMint);
      this.tokenToBondingCurve.set(bondingCurve.tokenMint, accountKey);
      
      // Calculate price
      const priceSol = this.calculatePrice(bondingCurve);
      const priceUsd = priceSol * this.solPriceUsd;
      
      const totalSupply = Number(bondingCurve.tokenTotalSupply) / 1e6;
      const marketCap = priceUsd * totalSupply;
      
      const solInCurve = Number(bondingCurve.realSolReserves) / 1e9;
      const liquidityUsd = solInCurve * this.solPriceUsd * 2;
      
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
        slot: data.slot || 0,
        curveProgress: bondingCurve.curveProgress,
        isComplete: bondingCurve.complete,
        totalSupply
      };
      
      this.emit('priceUpdate', priceUpdate);
      
      // Update token in database with bonding curve if not already set
      await this.updateTokenBondingCurve(bondingCurve.tokenMint, accountKey);
      
      // Check for near graduation
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
  
  private parseBondingCurveAccount(data: Buffer, bondingCurveAddress: string): BondingCurveAccount | null {
    try {
      // Use the structure from Shyft example
      const decoded = bondingCurveStructure.decode(data);
      
      const account: BondingCurveAccount = {
        discriminator: BigInt(decoded.discriminator),
        virtualTokenReserves: BigInt(decoded.virtualTokenReserves),
        virtualSolReserves: BigInt(decoded.virtualSolReserves),
        realTokenReserves: BigInt(decoded.realTokenReserves),
        realSolReserves: BigInt(decoded.realSolReserves),
        tokenTotalSupply: BigInt(decoded.tokenTotalSupply),
        complete: decoded.complete,
        tokenMint: decoded.tokenMint.toBase58(),
        bondingCurveAddress
      };
      
      // Calculate curve progress
      const realSolInLamports = Number(account.realSolReserves);
      const targetSolInLamports = 85 * 1e9; // 85 SOL target for graduation
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
  
  private async updateTokenBondingCurve(tokenAddress: string, bondingCurveAddress: string): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .whereNull('bonding_curve')
        .update({
          bonding_curve: bondingCurveAddress,
          updated_at: new Date()
        });
    } catch (error) {
      logger.debug('Error updating token bonding curve:', error);
    }
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
      
      return {
        signature,
        message: {
          header,
          accountKeys,
          recentBlockhash,
          instructions
        },
        meta
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
  
  async disconnect(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    
    this.isConnected = false;
    this.bondingCurveToToken.clear();
    this.tokenToBondingCurve.clear();
    
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
    // Not needed anymore as we subscribe to all bonding curves
    logger.debug(`Bonding curve ${bondingCurveAddress.substring(0, 8)}... will be tracked automatically`);
  }
  
  getBondingCurveForToken(tokenAddress: string): string | undefined {
    return this.tokenToBondingCurve.get(tokenAddress);
  }
  
  getTokenForBondingCurve(bondingCurve: string): string | undefined {
    return this.bondingCurveToToken.get(bondingCurve);
  }
  
  // Get stats including Shyft metadata service
  getStats() {
    return {
      ...this.stats,
      metadata: HELIUS_METADATA_SERVICE.getStats()
    };
  }
}
