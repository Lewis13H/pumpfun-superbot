import WebSocket from 'ws';
import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PumpFunToken } from './types';

export class PumpFunMonitor extends BaseMonitor {
  private connection: Connection;
  private ws: WebSocket | null = null;
  private httpPollInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  
  // PumpFun Program IDs (from pumpfun-bot)
  private PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  private PUMP_FUN_ACCOUNT = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

  constructor() {
    super('PumpFun');
    this.connection = new Connection(config.apis.heliusRpcUrl);
  }

  protected async startMonitoring(): Promise<void> {
    // Try multiple approaches
    await Promise.all([
      this.monitorBlockchain(),      // Novel approach: Direct blockchain monitoring
      this.tryAlternativeWebSocket(), // Try alternative WS endpoints
      this.startHttpPolling()         // Keep HTTP as backup
    ]);
  }

  // Novel Approach 1: Monitor blockchain directly for PumpFun transactions
  private async monitorBlockchain(): Promise<void> {
    try {
      // Subscribe to PumpFun program logs
      const subscriptionId = this.connection.onLogs(
        this.PUMP_FUN_PROGRAM,
        async (logs) => {
          if (logs.err) return;
          
          // Look for token creation events
          const isTokenCreation = logs.logs.some(log => 
            log.includes('InitializeMint') || 
            log.includes('create') ||
            log.includes('initialize')
          );

          if (isTokenCreation) {
            logger.info(`PumpFun token creation detected: ${logs.signature}`);
            
            // Try to process transaction
            await this.processTransactionForToken(logs.signature);
            
            // Also emit a basic detection to ensure we capture it
            this.emitDetectedToken(logs.signature);
          }
        },
        'confirmed'
      );

      logger.info(`PumpFun blockchain monitor active with subscription: ${subscriptionId}`);
    } catch (error) {
      logger.error('Failed to start blockchain monitoring:', error);
    }
  }

  // Novel Approach 2: Try alternative WebSocket endpoints
  private async tryAlternativeWebSocket(): Promise<void> {
    const alternativeEndpoints = [
      'wss://pumpportal.fun/api/data',
      'wss://frontend-api.pump.fun/ws',
      'wss://api.pump.fun/v1/ws'
    ];

    for (const endpoint of alternativeEndpoints) {
      try {
        await this.connectWebSocket(endpoint);
        logger.info(`Connected to PumpFun WebSocket: ${endpoint}`);
        break;
      } catch (error) {
        logger.debug(`Failed to connect to ${endpoint}, trying next...`);
      }
    }
  }

  private async connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        
        // Try different subscription methods
        ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
        ws.send(JSON.stringify({ method: 'subscribe', type: 'tokens' }));
        
        // Set up ping to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);
        
        resolve();
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.debug('Failed to parse WebSocket message');
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('close', () => {
        logger.debug(`WebSocket ${url} closed`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
      });

      ws.on('pong', () => {
        logger.debug('PumpFun WebSocket pong received');
      });
    });
  }

  private handleMessage(message: any): void {
    if (message.type === 'tokenCreate' || message.type === 'create' || message.type === 'newToken') {
      const tokenData = message.data || message;
      
      const token: TokenDiscovery = {
        address: tokenData.mint || tokenData.address || tokenData.tokenAddress,
        symbol: tokenData.symbol || 'UNKNOWN',
        name: tokenData.name || 'Unknown Token',
        platform: 'pumpfun',
        createdAt: new Date(tokenData.created_timestamp || tokenData.timestamp || Date.now()),
        metadata: {
          creator: tokenData.creator,
          description: tokenData.description,
          imageUri: tokenData.image_uri || tokenData.imageUri,
          bondingCurve: tokenData.bonding_curve || tokenData.bondingCurve,
          marketCap: tokenData.usd_market_cap || tokenData.marketCap,
          method: 'websocket'
        },
      };

      this.emitTokenDiscovery(token);
    }
  }

  private startHttpPolling(): void {
    // Poll every 30 seconds as backup
    this.httpPollInterval = setInterval(async () => {
      await this.pollRecentTokens();
    }, 30000);

    // Initial poll
    this.pollRecentTokens();
  }

  // Novel Approach 3: Use pump.fun website API endpoints
  private async pollAlternativeEndpoints(): Promise<void> {
    const endpoints = [
      'https://frontend-api.pump.fun/coins/created',
      'https://api.pump.fun/tokens/recent',
      'https://pump.fun/api/tokens'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, { 
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.data) {
          logger.info(`Found working endpoint: ${endpoint}`);
          // Process tokens from response
          return;
        }
      } catch (error) {
        // Silent fail, try next
      }
    }
  }

  private async processTransactionForToken(signature: string): Promise<void> {
    try {
      logger.debug(`Fetching transaction: ${signature}`);
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });

      if (!tx || !tx.meta) {
        logger.debug('Transaction not found or no metadata');
        return;
      }

      logger.debug(`Transaction has ${tx.transaction.message.instructions.length} instructions`);

      // Look for token creation in different ways
      let tokenFound = false;

      // Method 1: Check parsed instructions
      for (const [index, instruction] of tx.transaction.message.instructions.entries()) {
        if ('parsed' in instruction) {
          logger.debug(`Instruction ${index} type: ${instruction.parsed?.type}`);
          
          if (instruction.parsed?.type === 'create' || 
              instruction.parsed?.type === 'initializeMint' ||
              instruction.parsed?.type === 'createAccount') {
            
            const info = instruction.parsed.info;
            logger.debug(`Parsed instruction info:`, info);
            
            // Try to find mint address
            const mint = info.mint || info.account || info.newAccount;
            if (mint) {
              logger.info(`Found token mint via parsed instruction: ${mint}`);
              tokenFound = true;
              
              const token: TokenDiscovery = {
                address: mint,
                symbol: 'PUMP',
                name: 'PumpFun Token',
                platform: 'pumpfun',
                createdAt: new Date(),
                metadata: {
                  signature,
                  method: 'blockchain'
                }
              };

              this.emitTokenDiscovery(token);
            }
          }
        }
      }

      // Method 2: Check post token balances for new tokens
      if (!tokenFound && tx.meta.postTokenBalances && tx.meta.postTokenBalances.length > 0) {
        for (const balance of tx.meta.postTokenBalances) {
          if (balance.uiTokenAmount.uiAmount && balance.uiTokenAmount.uiAmount > 0) {
            const mint = balance.mint;
            logger.info(`Found token mint via postTokenBalances: ${mint}`);
            
            const token: TokenDiscovery = {
              address: mint,
              symbol: 'PUMP',
              name: 'PumpFun Token',
              platform: 'pumpfun',
              createdAt: new Date(),
              metadata: {
                signature,
                method: 'blockchain-balance'
              }
            };

            this.emitTokenDiscovery(token);
            tokenFound = true;
            break;
          }
        }
      }

      // Method 3: Check account keys for new accounts
      if (!tokenFound) {
        const accountKeys = tx.transaction.message.accountKeys;
        logger.debug(`Transaction has ${accountKeys.length} account keys`);
        
        // PumpFun tokens often have specific patterns in account keys
        for (const [index, key] of accountKeys.entries()) {
          logger.debug(`Account ${index}: ${key.pubkey.toString()}, writable: ${key.writable}, signer: ${key.signer}`);
        }
      }

      if (!tokenFound) {
        logger.warn(`Could not extract token from transaction: ${signature}`);
      }

    } catch (error) {
      logger.error('Error processing PumpFun transaction:', error);
    }
  }

  // Add this method to emit a token even without full details
  private emitDetectedToken(signature: string): void {
    const token: TokenDiscovery = {
      address: signature.substring(0, 44), // Use part of signature as temporary address
      symbol: 'PUMP-NEW',
      name: `PumpFun Token ${Date.now()}`,
      platform: 'pumpfun',
      createdAt: new Date(),
      metadata: {
        signature,
        method: 'blockchain-detection',
        needsEnrichment: true
      }
    };

    logger.info(`Emitting detected token from signature: ${signature}`);
    this.emitTokenDiscovery(token);
  }

  protected async stopMonitoring(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.httpPollInterval) {
      clearInterval(this.httpPollInterval);
      this.httpPollInterval = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private async pollRecentTokens(): Promise<void> {
    // First try the alternative endpoints
    await this.pollAlternativeEndpoints();
    
    // Then try the original endpoint
    try {
      const response = await axios.get(
        `${config.discovery.pumpfunApiUrl}/coins/recently-created`,
        {
          params: { limit: 50 },
          timeout: 10000,
        }
      );

      const tokens: PumpFunToken[] = response.data;
      
      for (const tokenData of tokens) {
        const token: TokenDiscovery = {
          address: tokenData.mint,
          symbol: tokenData.symbol,
          name: tokenData.name,
          platform: 'pumpfun',
          createdAt: new Date(tokenData.created_timestamp),
          metadata: {
            creator: tokenData.creator,
            description: tokenData.description,
            imageUri: tokenData.image_uri,
            bondingCurve: tokenData.bonding_curve,
            marketCap: tokenData.usd_market_cap,
            method: 'http'
          },
        };

        this.emitTokenDiscovery(token);
      }

      logger.debug(`Polled ${tokens.length} tokens from PumpFun API`);
    } catch (error: any) {
      if (error.response?.status !== 503) {
        logger.debug('PumpFun API error:', error.response?.status);
      }
    }
  }
}