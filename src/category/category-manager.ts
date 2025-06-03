import { interpret, Interpreter, State } from 'xstate';
import { TokenCategory, categoryConfig } from '../config/category-config';
import { createTokenStateMachine, TokenContext, TokenEvent } from './state-machines';
import { db } from '../database/postgres';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

// Type for state machine service
type TokenService = Interpreter<TokenContext, any, TokenEvent, any, any>;

export class CategoryManager extends EventEmitter {
  private machines: Map<string, TokenService> = new Map();
  private stateCache: Map<string, State<TokenContext, any, any, any, any>> = new Map();
  
  constructor() {
    super();
    this.loadExistingTokens();
  }
  
  /**
   * Load existing tokens and restore their state machines
   */
  private async loadExistingTokens(): Promise<void> {
    try {
      const tokens = await db('tokens')
        .whereNotIn('category', ['BIN', 'COMPLETE'])
        .select('address', 'category', 'market_cap', 'category_scan_count');
      
      logger.info(`Loading ${tokens.length} existing tokens into state machines`);
      
      for (const token of tokens) {
        await this.createOrRestoreStateMachine(
          token.address,
          token.category as TokenCategory,
          {
            currentMarketCap: Number(token.market_cap) || 0,
            scanCount: token.category_scan_count || 0,
          }
        );
      }
    } catch (error) {
      logger.error('Error loading existing tokens:', error);
    }
  }
  
  /**
   * Create or restore a state machine for a token
   */
  async createOrRestoreStateMachine(
    tokenAddress: string,
    currentCategory?: TokenCategory,
    context?: Partial<TokenContext>
  ): Promise<TokenService> {
    // Check if machine already exists
    if (this.machines.has(tokenAddress)) {
      return this.machines.get(tokenAddress)!;
    }
    
    // Create new machine
    const machine = createTokenStateMachine(tokenAddress);
    const service = interpret(machine)
      .onTransition((state) => this.handleStateTransition(tokenAddress, state))
      .start(currentCategory || 'NEW');
    
    // Update context if provided
    if (context) {
      service.send({
        type: 'UPDATE_MARKET_CAP',
        marketCap: context.currentMarketCap || 0,
      });
    }
    
    this.machines.set(tokenAddress, service);
    return service;
  }
  
  /**
   * Handle state transitions with proper transaction management
   */
  private async handleStateTransition(
    tokenAddress: string,
    state: State<TokenContext, any, any, any, any>
  ): Promise<void> {
    const previousState = this.stateCache.get(tokenAddress);
    this.stateCache.set(tokenAddress, state);
    
    // Skip if no actual transition
    if (previousState?.value === state.value) {
      return;
    }
    
    const fromCategory = previousState?.value as TokenCategory || 'NEW';
    const toCategory = state.value as TokenCategory;
    
    logger.info(`State transition: ${tokenAddress} ${fromCategory} → ${toCategory}`);
    
    // Use a transaction to ensure all operations complete atomically
    const trx = await db.transaction();
    
    try {
      // Update database
      await trx('tokens')
        .where('address', tokenAddress)
        .update({
          category: toCategory,
          previous_category: fromCategory,
          category_updated_at: new Date(),
          category_scan_count: 0, // Reset scan count on transition
        });
      
      // Record transition
      await trx('category_transitions').insert({
        token_address: tokenAddress,
        from_category: fromCategory,
        to_category: toCategory,
        market_cap_at_transition: state.context.currentMarketCap,
        reason: 'market_cap_change',
        metadata: {
          scanCount: state.context.scanCount,
        },
      });
      
      // Commit transaction
      await trx.commit();
      
      // Emit event (after transaction commits successfully)
      this.emit('categoryChange', {
        tokenAddress,
        fromCategory,
        toCategory,
        marketCap: state.context.currentMarketCap,
        timestamp: new Date(),
      });
      
      // Special handling for AIM entry
      if (toCategory === 'AIM') {
        await this.handleAimEntry(tokenAddress);
      }
      
      // Clean up if reached terminal state
      if (toCategory === 'BIN' || toCategory === 'COMPLETE') {
        this.machines.delete(tokenAddress);
        this.stateCache.delete(tokenAddress);
      }
    } catch (error) {
      // Rollback transaction on error
      await trx.rollback();
      logger.error(`Error handling state transition for ${tokenAddress}:`, error);
      // Don't throw - we don't want to crash the state machine
    }
  }
  
  /**
   * Update token with new market cap
   */
  async updateTokenMarketCap(tokenAddress: string, marketCap: number): Promise<void> {
    let service = this.machines.get(tokenAddress);
    
    if (!service) {
      // Create new machine if doesn't exist
      service = await this.createOrRestoreStateMachine(tokenAddress);
    }
    
    service.send({
      type: 'UPDATE_MARKET_CAP',
      marketCap,
    });
  }
  
  /**
   * Record scan completion
   */
  async recordScanComplete(tokenAddress: string): Promise<void> {
    const service = this.machines.get(tokenAddress);
    if (service) {
      service.send({ type: 'SCAN_COMPLETE' });
    }
  }
  
  /**
   * Manual category override
   */
  async manualCategoryOverride(
    tokenAddress: string, 
    category: TokenCategory, 
    reason: string
  ): Promise<void> {
    const service = this.machines.get(tokenAddress);
    if (service) {
      service.send({
        type: 'MANUAL_OVERRIDE',
        category,
        reason,
      });
    }
  }
  
  /**
   * Handle AIM entry with separate connection
   */
  private async handleAimEntry(tokenAddress: string): Promise<void> {
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .increment('aim_attempts', 1);
      
      this.emit('aimEntry', {
        tokenAddress,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(`Error handling AIM entry for ${tokenAddress}:`, error);
    }
  }
  
  /**
   * Get current state of a token
   */
  getTokenState(tokenAddress: string): State<TokenContext, any, any, any, any> | undefined {
    return this.stateCache.get(tokenAddress);
  }
  
  /**
   * Get all tokens in a specific category
   */
  async getTokensByCategory(category: TokenCategory): Promise<string[]> {
    const tokens = await db('tokens')
      .where('category', category)
      .select('address');
    
    return tokens.map(t => t.address);
  }
  
  /**
   * Get category distribution
   */
  async getCategoryDistribution(): Promise<Record<TokenCategory, number>> {
    const distribution = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category');
    
    const result: Record<string, number> = {};
    distribution.forEach(row => {
      result[row.category] = Number(row.count);
    });
    
    return result as Record<TokenCategory, number>;
  }
  
  /**
   * Bulk update multiple tokens with batching
   */
  async bulkUpdateMarketCaps(updates: Array<{ address: string; marketCap: number }>): Promise<void> {
    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await Promise.all(
        batch.map(update => this.updateTokenMarketCap(update.address, update.marketCap))
      );
      
      // Small delay between batches
      if (i + batchSize < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
  
  /**
   * Clean up completed/dead tokens
   */
  async cleanup(): Promise<void> {
    const deadTokens = await db('tokens')
      .whereIn('category', ['BIN', 'COMPLETE'])
      .select('address');
    
    for (const token of deadTokens) {
      this.machines.delete(token.address);
      this.stateCache.delete(token.address);
    }
    
    logger.info(`Cleaned up ${deadTokens.length} dead/completed tokens`);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      activeMachines: this.machines.size,
      cachedStates: this.stateCache.size,
    };
  }
  
  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    // Stop all state machines
    for (const [address, service] of Array.from(this.machines)) {
      service.stop();
    }
    
    this.machines.clear();
    this.stateCache.clear();
    
    logger.info('CategoryManager shut down');
  }
}

// Export singleton instance
export const categoryManager = new CategoryManager();