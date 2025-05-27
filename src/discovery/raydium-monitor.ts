import { Connection, PublicKey, Logs } from '@solana/web3.js';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { config } from '../config';
import { logger } from '../utils/logger';

export class RaydiumMonitor extends BaseMonitor {
  private connection: Connection;
  private raydiumProgramId: PublicKey;
  private subscriptionId: number | null = null;
  private processedSignatures: Set<string> = new Set();

  constructor() {
    super('Raydium');
    this.connection = new Connection(config.apis.heliusRpcUrl);
    this.raydiumProgramId = new PublicKey(config.discovery.raydiumProgramId);
  }

  protected async startMonitoring(): Promise<void> {
    // Subscribe to Raydium program logs
    this.subscriptionId = this.connection.onLogs(
      this.raydiumProgramId,
      (logs: Logs) => this.handleLogs(logs),
      'confirmed'
    );

    logger.info(`Raydium monitor subscribed with ID: ${this.subscriptionId}`);
  }

  protected async stopMonitoring(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }

  private async handleLogs(logs: Logs): Promise<void> {
    if (logs.err) {
      return;
    }

    // Prevent duplicate processing
    if (this.processedSignatures.has(logs.signature)) {
      return;
    }
    this.processedSignatures.add(logs.signature);

    // Clean up old signatures (keep last 1000)
    if (this.processedSignatures.size > 1000) {
      const signatures = Array.from(this.processedSignatures);
      signatures.slice(0, signatures.length - 1000).forEach(sig => {
        this.processedSignatures.delete(sig);
      });
    }

    // Check if this is a pool initialization
    const isPoolInit = logs.logs.some(log => 
      log.includes('initialize') || 
      log.includes('InitializeInstruction') ||
      log.includes('initialize2')
    );

    if (isPoolInit) {
      logger.debug(`Potential Raydium pool creation: ${logs.signature}`);
      await this.processPoolCreation(logs.signature);
    }
  }

  private async processPoolCreation(signature: string): Promise<void> {
    try {
      // Fetch the transaction
      const tx = await this.connection.getParsedTransaction(
        signature,
        { maxSupportedTransactionVersion: 0 }
      );

      if (!tx || !tx.meta) {
        return;
      }

      // Extract token mint from the transaction
      const tokenMint = this.extractTokenMint(tx);
      if (!tokenMint) {
        return;
      }

      // Get token info
      const tokenInfo = await this.getTokenInfo(tokenMint);
      
      const token: TokenDiscovery = {
        address: tokenMint,
        symbol: tokenInfo.symbol || 'UNKNOWN',
        name: tokenInfo.name || 'Unknown Token',
        platform: 'raydium',
        createdAt: new Date(),
        metadata: {
          poolSignature: signature,
          decimals: tokenInfo.decimals,
          supply: tokenInfo.supply,
        },
      };

      this.emitTokenDiscovery(token);
    } catch (error) {
      logger.error(`Error processing Raydium pool creation:`, error);
    }
  }

  private extractTokenMint(tx: any): string | null {
    try {
      // Look for token mint in the transaction
      const instructions = tx.transaction.message.instructions;
      
      for (const ix of instructions) {
        if (ix.parsed && ix.parsed.type === 'create' && ix.parsed.info?.mint) {
          return ix.parsed.info.mint;
        }
      }

      // Alternative: check account keys
      const accountKeys = tx.transaction.message.accountKeys;
      for (const key of accountKeys) {
        if (key.pubkey && !key.signer && !key.writable) {
          // This might be a token mint
          return key.pubkey.toString();
        }
      }

      return null;
    } catch (error) {
      logger.error('Error extracting token mint:', error);
      return null;
    }
  }

  private async getTokenInfo(mintAddress: string): Promise<any> {
    try {
      const mint = new PublicKey(mintAddress);
      const info = await this.connection.getParsedAccountInfo(mint);
      
      if (info.value && 'parsed' in info.value.data) {
        const parsed = info.value.data.parsed;
        return {
          decimals: parsed.info.decimals,
          supply: parsed.info.supply,
          symbol: 'NEW',
          name: 'New Token',
        };
      }

      return { symbol: 'UNKNOWN', name: 'Unknown Token' };
    } catch (error) {
      logger.error('Error getting token info:', error);
      return { symbol: 'UNKNOWN', name: 'Unknown Token' };
    }
  }
}