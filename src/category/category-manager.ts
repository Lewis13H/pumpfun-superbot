import { EventEmitter } from 'events';
import { interpret, Interpreter, State } from 'xstate';
import { db } from  '../database/postgres';
import { logger } from '../utils/logger2';
import { 
  createTokenCategoryMachine, 
  determineCategoryFromMarketCap,
  VALID_STATES,
  MARKET_CAP_THRESHOLDS,
  TokenContext,
  TokenEvent
} from './state-machines';

interface CategoryChangeEvent {
  tokenAddress: string;
  fromCategory: string;
  toCategory: string;
  marketCap: number;
  reason: string;
  timestamp: Date;
}

interface Token {
  address: string;
  symbol?: string;
  name?: string;
  market_cap?: number;
  category?: string;
}

type TokenMachineInterpreter = Interpreter<TokenContext, any, TokenEvent, any, any>

export class CategoryManager extends EventEmitter {
  private stateMachines: Map<string, TokenMachineInterpreter> = new Map();
  private initialized: boolean = false;

  constructor() {
    super();
    logger.info('CategoryManager initialized');
  }

  /**
   * Initialize the category manager and load existing tokens
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('CategoryManager already initialized');
      return;
    }

    try {
      // Quick database fix for NEW tokens (run once)
      await this.quickFixNewTokens();
      
      // First run the migration for any remaining NEW tokens
      await this.migrateNewTokens();
      
      // Then load all active tokens
      await this.initializeExistingTokens();
      
      this.initialized = true;
      logger.info('CategoryManager initialization complete');
    } catch (error) {
      logger.error('Failed to initialize CategoryManager:', error);
      throw error;
    }
  }

  /**
   * Quick fix to update NEW tokens in database
   */
  private async quickFixNewTokens(): Promise<void> {
    try {
      const result = await db.raw(`
        UPDATE tokens 
        SET category = CASE
          WHEN market_cap < 8000 THEN 'ARCHIVE'
          WHEN market_cap >= 8000 AND market_cap < 15000 THEN 'LOW'
          WHEN market_cap >= 15000 AND market_cap < 25000 THEN 'MEDIUM'
          WHEN market_cap >= 25000 AND market_cap < 35000 THEN 'HIGH'
          WHEN market_cap >= 35000 AND market_cap < 105000 THEN 'AIM'
          WHEN market_cap >= 105000 THEN 'GRADUATED'
          ELSE 'LOW'
        END,
        updated_at = NOW()
        WHERE category = 'NEW'
      `);
      
      if (result.rowCount > 0) {
        logger.info(`Quick fix: Updated ${result.rowCount} NEW tokens in database`);
      }
    } catch (error) {
      logger.error('Quick fix database update failed:', error);
      // Continue anyway - runtime fix will handle it
    }
  }

  /**
   * Initialize state machines for existing tokens
   */
  private async initializeExistingTokens(): Promise<void> {
    try {
      // Load all active tokens (exclude ARCHIVE)
      const tokens: Token[] = await db('tokens')
        .whereIn('category', ['LOW', 'MEDIUM', 'HIGH', 'AIM', 'GRADUATED'])
        .select('address', 'category', 'market_cap');
      
      for (const token of tokens) {
        this.createOrRestoreStateMachine(
          token.address,
          token.category,
          token.market_cap
        );
      }
      
      logger.info(`Initialized ${tokens.length} existing token state machines`);
    } catch (error) {
      logger.error('Failed to initialize existing tokens:', error);
      throw error;
    }
  }

  /**
   * Migrate tokens with legacy NEW category
   */
  private async migrateNewTokens(): Promise<void> {
    const newTokens: Token[] = await db('tokens')
      .where('category', 'NEW')
      .select('address', 'market_cap', 'symbol', 'name');
    
    if (newTokens.length === 0) {
      logger.info('No tokens with legacy NEW category found');
      return;
    }
    
    logger.info(`Found ${newTokens.length} tokens with legacy NEW category, migrating...`);
    
    for (const token of newTokens) {
      const newCategory = determineCategoryFromMarketCap(token.market_cap || 0);
      
      await db.transaction(async (trx: any) => {
        // Update token category
        await trx('tokens')
          .where('address', token.address)
          .update({
            category: newCategory,
            updated_at: new Date()
          });
        
        // Log transition
        await trx('category_transitions').insert({
          token_address: token.address,
          from_category: 'NEW',
          to_category: newCategory,
          market_cap_at_transition: token.market_cap || 0,
          reason: 'legacy_new_migration',
          created_at: new Date()
        });
      });
      
      logger.info(`Migrated token ${token.symbol || token.address.substring(0, 8)} from NEW to ${newCategory}`);
    }
    
    logger.info(`Successfully migrated ${newTokens.length} tokens from NEW category`);
  }

  /**
   * Create or restore a state machine for a token
   */
  private createOrRestoreStateMachine(
    tokenAddress: string,
    currentCategory?: string,
    marketCap?: number
  ): TokenMachineInterpreter {
    // Handle legacy 'NEW' state by mapping to appropriate category
    let initialState = currentCategory;
    
    // QUICK FIX: Handle legacy 'NEW' state
    if (currentCategory === 'NEW') {
      // Map NEW to appropriate category based on market cap
      initialState = determineCategoryFromMarketCap(marketCap || 0);
      
      logger.warn(`Migrating token ${tokenAddress} from legacy NEW state to ${initialState} (market cap: $${marketCap || 0})`);
      
      // Queue database update
      this.updateTokenCategoryInDb(tokenAddress, 'NEW', initialState, marketCap || 0, 'legacy_new_handling')
        .catch(error => logger.error(`Failed to update token ${tokenAddress} in database:`, error));
    }
    
    const machine = createTokenCategoryMachine(tokenAddress);
    
    // Create service (interpreter)
    const service = interpret(machine);
    
    // If we have a valid initial state, start with that state
    if (initialState && this.isValidState(initialState)) {
      try {
        service.start(initialState);
      } catch (error) {
        logger.error(`Failed to restore state for ${tokenAddress}, starting fresh:`, error);
        service.start();
      }
    } else {
      // Start with default initial state
      service.start();
    }
    
    // Store the service
    this.stateMachines.set(tokenAddress, service);
    
    // Set up state change listener
    service.onTransition((state) => {
      if (state.changed) {
        this.handleStateTransition(tokenAddress, state);
      }
    });
    
    logger.debug(`Created state machine for ${tokenAddress} in ${service.state.value} state`);
    return service;
  }

  /**
   * Validate if a state is valid
   */
  private isValidState(state: string): boolean {
    return VALID_STATES.includes(state);
  }

  /**
   * Handle price update for a token
   */
  async handlePriceUpdate(tokenAddress: string, marketCap: number): Promise<void> {
    try {
      let machine = this.stateMachines.get(tokenAddress);
      
      // If machine doesn't exist, create it
      if (!machine) {
        logger.info(`Creating new state machine for token ${tokenAddress}`);
        
        // Determine initial category based on market cap
        const initialCategory = determineCategoryFromMarketCap(marketCap);
        
        // Check if token exists in database
        const existingToken: Token | undefined = await db('tokens')
          .where('address', tokenAddress)
          .first();
        
        if (existingToken) {
          // Use existing category unless it's NEW
          const category = existingToken.category === 'NEW' ? initialCategory : existingToken.category;
          machine = this.createOrRestoreStateMachine(tokenAddress, category, marketCap);
        } else {
          // New token, create with determined category
          machine = this.createOrRestoreStateMachine(tokenAddress, initialCategory, marketCap);
        }
      }
      
      // Send price update event
      machine.send({
        type: 'PRICE_UPDATE',
        marketCap,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error(`Failed to handle price update for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Update token category directly (for grpc-stream-manager compatibility)
   */
  async updateTokenCategory(tokenAddress: string, newCategory: string, marketCap: number): Promise<void> {
    try {
      // Get current category
      const currentToken = await db('tokens')
        .where('address', tokenAddress)
        .select('category')
        .first();
      
      const currentCategory = currentToken?.category || 'UNKNOWN';
      
      // Update in database
      await this.updateTokenCategoryInDb(
        tokenAddress,
        currentCategory,
        newCategory,
        marketCap,
        'direct_update'
      );
      
      // Update or create state machine
      const machine = this.stateMachines.get(tokenAddress);
      if (machine) {
        // Send price update to trigger state change
        machine.send({
          type: 'PRICE_UPDATE',
          marketCap,
          timestamp: new Date()
        });
      } else {
        // Create new state machine with the category
        this.createOrRestoreStateMachine(tokenAddress, newCategory, marketCap);
      }
      
      logger.info(`Updated token ${tokenAddress} category to ${newCategory}`);
    } catch (error) {
      logger.error(`Failed to update token category for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Handle state transitions
   */
  private async handleStateTransition(tokenAddress: string, state: any): Promise<void> {
    const previousState = state.history?.value;
    const currentState = state.value;
    
    if (previousState && previousState !== currentState) {
      const event: CategoryChangeEvent = {
        tokenAddress,
        fromCategory: previousState,
        toCategory: currentState,
        marketCap: state.context.marketCap,
        reason: 'market_cap_change',
        timestamp: new Date()
      };
      
      // Update database
      await this.updateTokenCategoryInDb(
        tokenAddress,
        previousState,
        currentState,
        state.context.marketCap,
        'state_transition'
      );
      
      // Emit event
      this.emit('categoryChange', event);
      
      // If archived, remove state machine
      if (currentState === 'ARCHIVE') {
        this.stateMachines.delete(tokenAddress);
        logger.info(`Archived and removed state machine for ${tokenAddress}`);
      }
    }
  }

  /**
   * Update token category in database
   */
  private async updateTokenCategoryInDb(
    tokenAddress: string,
    fromCategory: string,
    toCategory: string,
    marketCap: number,
    reason: string
  ): Promise<void> {
    try {
      await db.transaction(async (trx: any) => {
        // Update token
        await trx('tokens')
          .where('address', tokenAddress)
          .update({
            category: toCategory,
            market_cap: marketCap,
            updated_at: new Date()
          });
        
        // Log transition
        await trx('category_transitions').insert({
          token_address: tokenAddress,
          from_category: fromCategory,
          to_category: toCategory,
          market_cap_at_transition: marketCap,
          reason,
          created_at: new Date()
        });
      });
    } catch (error) {
      logger.error(`Failed to update token category for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Force archive a token
   */
  async archiveToken(tokenAddress: string, reason: string = 'manual'): Promise<void> {
    const machine = this.stateMachines.get(tokenAddress);
    if (machine) {
      machine.send({ type: 'FORCE_ARCHIVE' });
      logger.info(`Force archived token ${tokenAddress} - Reason: ${reason}`);
    }
  }

  /**
   * Get current category for a token
   */
  getCurrentCategory(tokenAddress: string): string | null {
    const machine = this.stateMachines.get(tokenAddress);
    return machine ? machine.state.value as string : null;
  }

  /**
   * Get all active tokens by category
   */
  getTokensByCategory(category: string): string[] {
    const tokens: string[] = [];
    this.stateMachines.forEach((machine, tokenAddress) => {
      if (machine.state.value === category) {
        tokens.push(tokenAddress);
      }
    });
    return tokens;
  }

  /**
   * Get statistics
   */
  getStatistics(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.stateMachines.size,
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      AIM: 0,
      GRADUATED: 0
    };
    
    this.stateMachines.forEach((machine) => {
      const state = machine.state.value as string;
      if (stats[state] !== undefined) {
        stats[state]++;
      }
    });
    
    return stats;
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down CategoryManager...');
    
    // Stop all state machines
    this.stateMachines.forEach((machine) => {
      machine.stop();
    });
    
    this.stateMachines.clear();
    this.removeAllListeners();
    
    logger.info('CategoryManager shutdown complete');
  }
}

// Export singleton instance
export const categoryManager = new CategoryManager();