// src/services/token-holder-analytics-service.ts
// V4.23: Token Holder Analytics using Helius DAS API - FIXED TypeScript errors

import { EventEmitter } from 'events';
import { logger } from '../utils/logger2';
import { db } from '../database/postgres';

export interface HolderMetrics {
  tokenAddress: string;
  totalHolders: number;
  top10Percent: number;
  top25Percent: number;
  holderDistribution: {
    top1: number;
    top5: number;
    top10: number;
    top25: number;
    top50: number;
  };
  lastUpdated: Date;
  dataSource: 'helius_das' | 'helius_enhanced' | 'fallback';
}

export interface HolderAccount {
  address: string;
  amount: string;
  decimals: number;
  percentage: number;
  rank: number;
}

// Type definitions for API responses
interface HeliusApiResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: {
    message: string;
    code: number;
  };
}

export class TokenHolderAnalyticsService extends EventEmitter {
  private readonly heliusRpcUrl: string;
  private readonly processingQueue: Set<string> = new Set();
  private readonly retryQueue: Map<string, number> = new Map();
  private readonly requestDelay: number = 250; // 250ms between requests
  private readonly maxRetries: number = 3;
  private isRunning: boolean = false;
  private processingInterval?: NodeJS.Timeout;

  constructor(heliusRpcUrl: string) {
    super();
    this.heliusRpcUrl = heliusRpcUrl;
  }

  /**
   * Start the holder analytics service
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('🔍 Token Holder Analytics Service starting...');

    // Start periodic processing
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, this.requestDelay);

    // Initial processing of high-priority tokens
    setTimeout(() => {
      this.queueHighPriorityTokens();
    }, 5000);

    logger.info('✅ Token Holder Analytics Service started');
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingQueue.clear();
    this.retryQueue.clear();
    
    logger.info('Token Holder Analytics Service stopped');
  }

  /**
   * Queue token for holder analysis (with priority)
   */
  queueTokenForHolderAnalysis(tokenAddress: string, priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM'): void {
    if (!this.processingQueue.has(tokenAddress) && !this.retryQueue.has(tokenAddress)) {
      this.processingQueue.add(tokenAddress);
      
      logger.debug(`📊 Queued holder analysis: ${tokenAddress.substring(0, 8)}... (${priority})`);
      
      // Emit event for tracking
      this.emit('queued', { tokenAddress, priority });
    }
  }

  /**
   * Queue high-priority tokens (AIM category)
   */
  private async queueHighPriorityTokens(): Promise<void> {
    try {
      // Get AIM tokens that need holder data updates (every 3 minutes)
      const aimTokens = await db('tokens')
        .where('category', 'AIM')
        .where(function() {
          this.whereNull('holders')
            .orWhereNull('top_10_percent')
            .orWhere('updated_at', '<', new Date(Date.now() - 3 * 60 * 1000)); // Older than 3 min
        })
        .orderBy('market_cap', 'desc')
        .limit(30);

      logger.info(`📊 Queuing ${aimTokens.length} AIM tokens for holder analysis`);

      aimTokens.forEach(token => {
        this.queueTokenForHolderAnalysis(token.address, 'HIGH');
      });

    } catch (error) {
      logger.error('Error queuing high-priority tokens:', error);
    }
  }

  /**
   * Process the queue - FIXED TypeScript errors
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue.size === 0) return;

    // FIXED: Properly handle undefined from Set iterator
    const iterator = this.processingQueue.values();
    const next = iterator.next();
    
    if (next.done || !next.value) return;
    
    const tokenAddress: string = next.value;
    this.processingQueue.delete(tokenAddress);

    try {
      await this.analyzeTokenHolders(tokenAddress);
    } catch (error) {
      logger.error(`Error analyzing holders for ${tokenAddress}:`, error);
      
      // Add to retry queue
      const retryCount = this.retryQueue.get(tokenAddress) || 0;
      if (retryCount < this.maxRetries) {
        this.retryQueue.set(tokenAddress, retryCount + 1);
        setTimeout(() => {
          this.processingQueue.add(tokenAddress);
          this.retryQueue.delete(tokenAddress);
        }, 5000 * (retryCount + 1)); // Exponential backoff
      }
    }
  }

  /**
   * Analyze token holders using multiple methods
   */
  private async analyzeTokenHolders(tokenAddress: string): Promise<HolderMetrics | null> {
    logger.debug(`🔍 Analyzing holders for ${tokenAddress.substring(0, 8)}...`);

    try {
      // Method 1: Try DAS API first (most comprehensive)
      const dasResult = await this.fetchHoldersWithDAS(tokenAddress);
      if (dasResult) {
        await this.updateTokenHolderData(tokenAddress, dasResult);
        this.emit('holdersUpdated', dasResult);
        return dasResult;
      }

      // Method 2: Try Enhanced RPC
      const enhancedResult = await this.fetchHoldersWithEnhancedRPC(tokenAddress);
      if (enhancedResult) {
        await this.updateTokenHolderData(tokenAddress, enhancedResult);
        this.emit('holdersUpdated', enhancedResult);
        return enhancedResult;
      }

      // Method 3: Fallback basic method
      const fallbackResult = await this.fetchHoldersWithBasicRPC(tokenAddress);
      if (fallbackResult) {
        await this.updateTokenHolderData(tokenAddress, fallbackResult);
        this.emit('holdersUpdated', fallbackResult);
        return fallbackResult;
      }

      logger.warn(`❌ No holder data available for ${tokenAddress}`);
      return null;

    } catch (error) {
      logger.error(`Error in analyzeTokenHolders for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Fetch holders using Helius DAS API (best method) - FIXED TypeScript errors
   */
  private async fetchHoldersWithDAS(tokenAddress: string): Promise<HolderMetrics | null> {
    try {
      const response = await fetch(this.heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `holders-${Date.now()}`,
          method: 'getAsset',
          params: {
            id: tokenAddress,
            displayOptions: {
              showFungibleTokenMetadata: true
            }
          }
        })
      });

      if (!response.ok) throw new Error(`DAS API error: ${response.status}`);

      // FIXED: Properly type the response
      const data = await response.json() as HeliusApiResponse;
      
      if (data.error) {
        logger.debug(`DAS API error for ${tokenAddress}: ${data.error.message}`);
        return null;
      }

      // Get token accounts for holder analysis
      const holdersResponse = await this.fetchTokenAccounts(tokenAddress);
      if (!holdersResponse) return null;

      return this.calculateHolderMetrics(tokenAddress, holdersResponse, 'helius_das');

    } catch (error) {
      logger.debug(`DAS method failed for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch token accounts and calculate holder metrics - FIXED TypeScript errors
   */
  private async fetchTokenAccounts(tokenAddress: string): Promise<HolderAccount[] | null> {
    try {
      const response = await fetch(this.heliusRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `accounts-${Date.now()}`,
          method: 'getProgramAccounts',
          params: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            {
              encoding: 'jsonParsed',
              filters: [
                { dataSize: 165 },
                { memcmp: { offset: 0, bytes: tokenAddress } }
              ]
            }
          ]
        })
      });

      if (!response.ok) throw new Error(`Token accounts error: ${response.status}`);

      // FIXED: Properly type the response
      const data = await response.json() as HeliusApiResponse;
      
      if (data.error || !data.result) {
        logger.debug(`No token accounts found for ${tokenAddress}`);
        return null;
      }

      // Parse and sort accounts by balance
      const accounts: HolderAccount[] = data.result
        .filter((account: any) => {
          const amount = parseFloat(account.account.data.parsed.info.tokenAmount.uiAmount || '0');
          return amount > 0; // Only non-zero balances
        })
        .map((account: any, index: number) => {
          const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
          return {
            address: account.account.data.parsed.info.owner,
            amount: amount.toString(),
            decimals: account.account.data.parsed.info.tokenAmount.decimals,
            percentage: 0, // Will calculate after sorting
            rank: index + 1
          };
        })
        .sort((a: HolderAccount, b: HolderAccount) => parseFloat(b.amount) - parseFloat(a.amount));

      // Calculate total supply and percentages
      const totalSupply = accounts.reduce((sum, acc) => sum + parseFloat(acc.amount), 0);
      
      accounts.forEach((account, index) => {
        account.percentage = (parseFloat(account.amount) / totalSupply) * 100;
        account.rank = index + 1;
      });

      return accounts;

    } catch (error) {
      logger.debug(`Error fetching token accounts for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Enhanced RPC method (backup)
   */
  private async fetchHoldersWithEnhancedRPC(tokenAddress: string): Promise<HolderMetrics | null> {
    try {
      // This would use Helius enhanced RPC endpoints
      // Implementation similar to DAS but with different endpoints
      logger.debug(`Trying enhanced RPC for ${tokenAddress}`);
      
      // For now, return null to fall back to basic method
      return null;

    } catch (error) {
      logger.debug(`Enhanced RPC failed for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Basic RPC fallback
   */
  private async fetchHoldersWithBasicRPC(tokenAddress: string): Promise<HolderMetrics | null> {
    try {
      // Basic implementation - just get approximate holder count
      const accounts = await this.fetchTokenAccounts(tokenAddress);
      if (!accounts) return null;

      return this.calculateHolderMetrics(tokenAddress, accounts, 'fallback');

    } catch (error) {
      logger.debug(`Basic RPC failed for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate holder metrics from account data
   */
  private calculateHolderMetrics(
    tokenAddress: string, 
    accounts: HolderAccount[], 
    dataSource: HolderMetrics['dataSource']
  ): HolderMetrics {
    const totalHolders = accounts.length;
    
    // Calculate concentration percentages
    const top1Count = Math.max(1, Math.ceil(totalHolders * 0.01));
    const top5Count = Math.max(1, Math.ceil(totalHolders * 0.05));
    const top10Count = Math.max(1, Math.ceil(totalHolders * 0.10));
    const top25Count = Math.max(1, Math.ceil(totalHolders * 0.25));
    const top50Count = Math.max(1, Math.ceil(totalHolders * 0.50));

    const top1Percentage = accounts.slice(0, top1Count)
      .reduce((sum, acc) => sum + acc.percentage, 0);
    const top5Percentage = accounts.slice(0, top5Count)
      .reduce((sum, acc) => sum + acc.percentage, 0);
    const top10Percentage = accounts.slice(0, top10Count)
      .reduce((sum, acc) => sum + acc.percentage, 0);
    const top25Percentage = accounts.slice(0, top25Count)
      .reduce((sum, acc) => sum + acc.percentage, 0);
    const top50Percentage = accounts.slice(0, top50Count)
      .reduce((sum, acc) => sum + acc.percentage, 0);

    const metrics: HolderMetrics = {
      tokenAddress,
      totalHolders,
      top10Percent: Math.round(top10Percentage * 100) / 100,
      top25Percent: Math.round(top25Percentage * 100) / 100,
      holderDistribution: {
        top1: Math.round(top1Percentage * 100) / 100,
        top5: Math.round(top5Percentage * 100) / 100,
        top10: Math.round(top10Percentage * 100) / 100,
        top25: Math.round(top25Percentage * 100) / 100,
        top50: Math.round(top50Percentage * 100) / 100,
      },
      lastUpdated: new Date(),
      dataSource
    };

    logger.info(`📊 Holder metrics for ${tokenAddress.substring(0, 8)}...`, {
      holders: totalHolders,
      top10: `${metrics.top10Percent}%`,
      top25: `${metrics.top25Percent}%`,
      source: dataSource
    });

    return metrics;
  }

  /**
   * Update token holder data in database
   */
  private async updateTokenHolderData(tokenAddress: string, metrics: HolderMetrics): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          holders: metrics.totalHolders,
          top_10_percent: metrics.top10Percent,
          top_25_percent: metrics.top25Percent, // New column needed
          holder_distribution: JSON.stringify(metrics.holderDistribution),
          holder_data_source: metrics.dataSource,
          holder_last_updated: metrics.lastUpdated,
          updated_at: new Date()
        });

      logger.debug(`✅ Updated holder data for ${tokenAddress.substring(0, 8)}...`);

    } catch (error) {
      logger.error(`Error updating holder data for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Queue tokens by category priority
   */
  async queueTokensByCategory(): Promise<void> {
    try {
      // AIM tokens (highest priority) - every 3 minutes
      const aimTokens = await db('tokens')
        .where('category', 'AIM')
        .where(function() {
          this.whereNull('holder_last_updated')
            .orWhere('holder_last_updated', '<', new Date(Date.now() - 3 * 60 * 1000));
        })
        .orderBy('market_cap', 'desc')
        .limit(30);

      aimTokens.forEach(token => {
        this.queueTokenForHolderAnalysis(token.address, 'HIGH');
      });

      // HIGH tokens (medium priority) - every 10 minutes  
      const highTokens = await db('tokens')
        .where('category', 'HIGH')
        .where(function() {
          this.whereNull('holder_last_updated')
            .orWhere('holder_last_updated', '<', new Date(Date.now() - 10 * 60 * 1000));
        })
        .orderBy('market_cap', 'desc')
        .limit(20);

      highTokens.forEach(token => {
        this.queueTokenForHolderAnalysis(token.address, 'MEDIUM');
      });

      // MEDIUM tokens (low priority) - every 1 hour
      const mediumTokens = await db('tokens')
        .where('category', 'MEDIUM')
        .where(function() {
          this.whereNull('holder_last_updated')
            .orWhere('holder_last_updated', '<', new Date(Date.now() - 1 * 60 * 60 * 1000));
        })
        .orderBy('market_cap', 'desc')
        .limit(15);

      mediumTokens.forEach(token => {
        this.queueTokenForHolderAnalysis(token.address, 'LOW');
      });

      // LOW/NEW tokens (lowest priority) - every 6 hours
      const lowNewTokens = await db('tokens')
        .whereIn('category', ['LOW', 'NEW'])
        .where(function() {
          this.whereNull('holder_last_updated')
            .orWhere('holder_last_updated', '<', new Date(Date.now() - 6 * 60 * 60 * 1000));
        })
        .orderBy('market_cap', 'desc')
        .limit(10);

      lowNewTokens.forEach(token => {
        this.queueTokenForHolderAnalysis(token.address, 'LOW');
      });

      logger.info(`📊 Queued holders analysis: ${aimTokens.length} AIM, ${highTokens.length} HIGH, ${mediumTokens.length} MEDIUM, ${lowNewTokens.length} LOW/NEW`);

    } catch (error) {
      logger.error('Error queuing tokens by category:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats(): any {
    return {
      processingQueue: this.processingQueue.size,
      retryQueue: this.retryQueue.size,
      requestDelay: this.requestDelay,
      isRunning: this.isRunning,
      maxRetries: this.maxRetries
    };
  }

  /**
   * Force update holder data for specific token
   */
  async forceUpdateHolders(tokenAddress: string): Promise<HolderMetrics | null> {
    logger.info(`🔍 Force updating holders for ${tokenAddress}`);
    return await this.analyzeTokenHolders(tokenAddress);
  }

  /**
   * Get holder summary for dashboard
   */
  async getHolderSummary(limit: number = 20): Promise<any[]> {
    return await db('tokens')
      .select([
        'address', 'symbol', 'name', 'category', 'market_cap',
        'holders', 'top_10_percent', 'top_25_percent',
        'holder_last_updated', 'holder_data_source'
      ])
      .whereNotNull('holders')
      .orderBy('holder_last_updated', 'desc')
      .limit(limit);
  }
}

// Export singleton instance
export const HOLDER_ANALYTICS_SERVICE = new TokenHolderAnalyticsService(
  process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=d2fa57b6-40cc-45e4-80f8-285377ec5dea'
);