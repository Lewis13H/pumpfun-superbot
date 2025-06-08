import { EventEmitter } from 'events';
import { buySignalEvaluator, BuyEvaluation } from './buy-signal-evaluator';
import { positionSizer, PositionSize } from './position-sizer';
import { categoryManager } from '../category/category-manager';
import { logger } from '../utils/logger2';
import { db } from '../database/postgres';

export interface BuySignal {
  tokenAddress: string;
  symbol: string;
  evaluation: BuyEvaluation;
  position: PositionSize;
  timestamp: Date;
  executed: boolean;
}

export class BuySignalService extends EventEmitter {
  private activeSignals: Map<string, BuySignal> = new Map();
  private isRunning: boolean = false;
  private checkInterval?: NodeJS.Timeout;
  
  /**
   * Start the buy signal service
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('Buy Signal Service started');
    
    // Listen for AIM entries
    categoryManager.on('aimEntry', async (event) => {
      logger.info(`New AIM entry: ${event.tokenAddress} - scheduling evaluation`);
      // Wait a bit for full analysis to complete
      setTimeout(() => this.evaluateToken(event.tokenAddress), 30000);
    });
    
    // Start periodic check for ready tokens
    this.checkInterval = setInterval(() => this.checkForReadyTokens(), 60000);
    
    // Initial check
    await this.checkForReadyTokens();
  }
  
  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    logger.info('Buy Signal Service stopped');
  }
  
  /**
   * Check for tokens ready for evaluation
   */
  private async checkForReadyTokens(): Promise<void> {
    try {
      const readyTokens = await buySignalEvaluator.getAimTokensForEvaluation();
      
      for (const token of readyTokens) {
        // Skip if already has active signal
        if (this.activeSignals.has(token.address)) continue;
        
        await this.evaluateToken(token.address);
      }
    } catch (error) {
      logger.error('Error checking for ready tokens:', error);
    }
  }
  
  /**
   * Evaluate a specific token
   */
  private async evaluateToken(tokenAddress: string): Promise<void> {
    try {
      // Get token info
      const token = await db('tokens')
        .where('address', tokenAddress)
        .first();
      
      if (!token || token.category !== 'AIM') {
        return;
      }
      
      logger.info(`Evaluating ${token.symbol} for buy signal`);
      
      // Perform evaluation
      const evaluation = await buySignalEvaluator.evaluateToken(tokenAddress);
      
      if (evaluation.passed) {
        // Calculate position size
        const position = positionSizer.calculatePosition(evaluation);
        
        // Create buy signal
        const signal: BuySignal = {
          tokenAddress,
          symbol: token.symbol,
          evaluation,
          position,
          timestamp: new Date(),
          executed: false,
        };
        
        this.activeSignals.set(tokenAddress, signal);
        
        // Emit buy signal
        this.emit('buySignal', signal);
        
        logger.info(`🎯 BUY SIGNAL: ${token.symbol} - Position: ${position.finalPosition} SOL`);
        
        // Record signal
        await this.recordSignal(signal);
      }
    } catch (error) {
      logger.error(`Error evaluating token ${tokenAddress}:`, error);
    }
  }
  
  /**
   * Record signal in database
   */
  private async recordSignal(signal: BuySignal): Promise<void> {
    await db('token_signals').insert({
      token_address: signal.tokenAddress,
      signal_type: 'BUY',
      confidence: signal.evaluation.confidence,
      strategy_scores: JSON.stringify({
        marketCap: signal.evaluation.marketCap,
        liquidity: signal.evaluation.liquidity,
        holders: signal.evaluation.holders,
        solsniffer: signal.evaluation.solsnifferScore,
      }),
      target_price: signal.evaluation.marketCap * 1.5 / 1_000_000_000, // 50% target
      stop_loss: signal.evaluation.marketCap * 0.8 / 1_000_000_000, // 20% stop
      reason: `All criteria passed. Position: ${signal.position.finalPosition} SOL`,
      generated_at: signal.timestamp,
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 minute expiry
    });
  }
  
  /**
   * Mark signal as executed
   */
  async markExecuted(tokenAddress: string, txHash?: string): Promise<void> {
    const signal = this.activeSignals.get(tokenAddress);
    if (signal) {
      signal.executed = true;
      
      // Update category manager
      const service = (categoryManager as any).machines.get(tokenAddress);
      if (service) {
        service.send({ type: 'BUY_EXECUTED' });
      }
    }
  }
  
  /**
   * Get active signals
   */
  getActiveSignals(): BuySignal[] {
    return Array.from(this.activeSignals.values())
      .filter(s => !s.executed)
      .sort((a, b) => b.evaluation.confidence - a.evaluation.confidence);
  }
  
  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const evalStats = await buySignalEvaluator.getStats();
    
    return {
      ...evalStats,
      activeSignals: this.activeSignals.size,
      unexecutedSignals: this.getActiveSignals().length,
    };
  }
}

// Export singleton instance
export const buySignalService = new BuySignalService();

