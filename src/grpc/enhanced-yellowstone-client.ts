// src/grpc/enhanced-yellowstone-client.ts
import { EventEmitter } from 'events';
import { struct, u64, bool, publicKey } from '@project-serum/borsh';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger2';

const YellowstoneGrpc = require('@triton-one/yellowstone-grpc');
const Client = YellowstoneGrpc.default;

// Enhanced bonding curve structure
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

export interface DualAddressToken {
  splTokenAddress: string;      // SPL token mint address
  pumpfunAddress: string;        // Bonding curve address (pump.fun identifier)
  bondingCurveData: any;
  slot: bigint;
  timestamp: Date;
}

export class EnhancedYellowstoneClient extends EventEmitter {
  private client: any;
  private stream: any;
  private isConnected = false;
  
  // Dual mapping for fast lookups
  private splToPumpfun = new Map<string, string>();
  private pumpfunToSpl = new Map<string, string>();
  
  constructor(
    private endpoint: string,
    private token: string,
    private pumpProgramId = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
  ) {
    super();
    
    // Clean and prepare connection parameters
    const cleanEndpoint = endpoint.trim().replace(/['"]/g, '');
    const endpointWithProtocol = cleanEndpoint.includes('://') 
      ? cleanEndpoint 
      : `https://${cleanEndpoint}`;
    const cleanToken = token.trim().replace(/['"]/g, '');
    
    this.client = new Client(endpointWithProtocol, cleanToken, undefined);
  }
  
  async connect(): Promise<void> {
    try {
      logger.info('🔌 Connecting to Enhanced Yellowstone gRPC...');
      
      this.stream = await this.client.subscribe();
      this.setupStreamHandlers();
      await this.sendSubscriptionRequest();
      
      this.isConnected = true;
      this.emit('connected');
      
      logger.info('✅ Enhanced gRPC connected with dual address support');
    } catch (error) {
      logger.error('Failed to connect:', error);
      throw error;
    }
  }
  
  private setupStreamHandlers(): void {
    this.stream.on('data', (data: any) => {
      this.handleStreamData(data).catch(error => {
        logger.error('Stream data handling error:', error);
      });
    });
    
    this.stream.on('error', (error: Error) => {
      logger.error('Stream error:', error);
      this.emit('error', error);
      this.reconnect();
    });
    
    this.stream.on('end', () => {
      logger.warn('Stream ended');
      this.isConnected = false;
      this.emit('disconnected');
      this.reconnect();
    });
  }
  
  private async sendSubscriptionRequest(): Promise<void> {
    const request = {
      slots: {},
      accounts: {
        // Monitor ALL pump.fun bonding curves
        pumpBondingCurves: {
          account: [],
          filters: [{
            memcmp: {
              offset: bondingCurveStructure.offsetOf('complete').toString(),
              bytes: Uint8Array.from([0]) // Only active curves
            }
          }],
          owner: [this.pumpProgramId]
        }
      },
      transactions: {
        // Monitor pump.fun transactions
        pumpFun: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [this.pumpProgramId],
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
      commitment: 1 // CONFIRMED
    };
    
    return new Promise<void>((resolve, reject) => {
      this.stream.write(request, (err: any) => {
        if (err) {
          reject(err);
        } else {
          logger.info('📡 Enhanced subscription sent');
          resolve();
        }
      });
    });
  }
  
  private async handleStreamData(data: any): Promise<void> {
    try {
      // Handle account updates (bonding curves)
      if (data.account) {
        await this.handleAccountUpdate(data);
      }
      
      // Handle transactions
      if (data.transaction) {
        await this.handleTransaction(data);
      }
    } catch (error) {
      logger.error('Error processing stream data:', error);
    }
  }
  
  private async handleAccountUpdate(data: any): Promise<void> {
    const { account, slot } = data;
    const accountKey = new PublicKey(Buffer.from(account.account.pubkey, 'base64')).toBase58();
    const accountData = Buffer.from(account.account.data, 'base64');
    
    try {
      // Parse bonding curve data
      const decoded = bondingCurveStructure.decode(accountData);
      const splTokenAddress = new PublicKey(decoded.tokenMint).toBase58();
      const pumpfunAddress = accountKey; // The bonding curve address IS the pump.fun identifier
      
      // Update dual mappings
      this.splToPumpfun.set(splTokenAddress, pumpfunAddress);
      this.pumpfunToSpl.set(pumpfunAddress, splTokenAddress);
      
      // Emit dual address token data
      const dualAddressToken: DualAddressToken = {
        splTokenAddress,
        pumpfunAddress,
        bondingCurveData: {
          virtualTokenReserves: decoded.virtualTokenReserves.toString(),
          virtualSolReserves: decoded.virtualSolReserves.toString(),
          realTokenReserves: decoded.realTokenReserves.toString(),
          realSolReserves: decoded.realSolReserves.toString(),
          tokenTotalSupply: decoded.tokenTotalSupply.toString(),
          complete: decoded.complete
        },
        slot: BigInt(slot),
        timestamp: new Date()
      };
      
      this.emit('dualAddressUpdate', dualAddressToken);
      
      // Also emit legacy events for backward compatibility
      this.emit('accountUpdate', {
        accountKey: pumpfunAddress,
        tokenMint: splTokenAddress,
        slot,
        data: decoded
      });
      
    } catch (error) {
      logger.error(`Failed to parse bonding curve ${accountKey}:`, error);
    }
  }
  
  private async handleTransaction(data: any): Promise<void> {
    // Extract transaction details
    const slot = data.transaction.slot;
    const signature = Buffer.from(data.transaction.transaction.signature, 'base64').toString('base64');
    
    // Parse and emit transaction with dual address context
    this.emit('transaction', {
      signature,
      slot,
      data: data.transaction
    });
  }
  
  // Universal lookup methods
  getSplAddress(anyAddress: string): string | undefined {
    // Check if it's already an SPL address
    if (this.splToPumpfun.has(anyAddress)) {
      return anyAddress;
    }
    // Check if it's a pump.fun address
    return this.pumpfunToSpl.get(anyAddress);
  }
  
  getPumpfunAddress(anyAddress: string): string | undefined {
    // Check if it's already a pump.fun address
    if (this.pumpfunToSpl.has(anyAddress)) {
      return anyAddress;
    }
    // Check if it's an SPL address
    return this.splToPumpfun.get(anyAddress);
  }
  
  getAddressPair(anyAddress: string): { spl: string; pumpfun: string } | undefined {
    const splAddress = this.getSplAddress(anyAddress);
    const pumpfunAddress = this.getPumpfunAddress(anyAddress);
    
    if (splAddress && pumpfunAddress) {
      return { spl: splAddress, pumpfun: pumpfunAddress };
    }
    return undefined;
  }
  
  private async reconnect(): Promise<void> {
    if (this.isConnected) return;
    
    logger.info('🔄 Attempting to reconnect...');
    setTimeout(() => {
      this.connect().catch(error => {
        logger.error('Reconnection failed:', error);
      });
    }, 5000);
  }
  
  async disconnect(): Promise<void> {
    if (this.stream) {
      this.stream.end();
    }
    this.isConnected = false;
    this.emit('disconnected');
  }
}