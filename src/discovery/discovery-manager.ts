// src/discovery/discovery-manager.ts
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { PumpFunMonitor } from './pumpfun-monitor';
import { EnhancedPumpFunMonitor } from './enhanced-pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { TokenProcessor } from './token-processor';
import { TokenStorageAdapter } from './token-storage-adapter';
import { DeduplicationService } from './deduplication-service';
import { config } from '../config';
import { logger } from '../utils/logger';

export class DiscoveryManager extends EventEmitter {
  private monitors: Map<string, BaseMonitor> = new Map();
  private queue: PQueue;
  private tokenProcessor: TokenProcessor;
  private storageAdapter: TokenStorageAdapter;
  private deduplicationService: DeduplicationService;
  private isRunning: boolean = false;
  private processedTokens: Set<string> = new Set();
  private useEnhancedPumpFun: boolean = true; // Flag to switch between monitors

  constructor() {
    super();
    
    this.queue = new PQueue({ 
      concurrency: config.discovery.maxConcurrentProcessing || 10 
    });
    
    this.tokenProcessor = new TokenProcessor();
    this.storageAdapter = new TokenStorageAdapter();
    this.deduplicationService = new DeduplicationService();
    
    this.initializeMonitors();
  }

  private initializeMonitors(): void {
    // Use enhanced pump.fun monitor if available
    if (this.useEnhancedPumpFun) {
      try {
        const enhancedMonitor = new EnhancedPumpFunMonitor();
        this.monitors.set('pumpfun-enhanced', enhancedMonitor);
        logger.info('Using enhanced PumpFun monitor with IDL integration');
      } catch (error) {
        logger.warn('Failed to initialize enhanced PumpFun monitor, falling back to basic:', error);
        this.monitors.set('pumpfun', new PumpFunMonitor());
      }
    } else {
      this.monitors.set('pumpfun', new PumpFunMonitor());
    }
    
    this.monitors.set('raydium', new RaydiumMonitor());
    
    // Set up event listeners for each monitor
    this.monitors.forEach((monitor, name) => {
      monitor.on('tokenDiscovered', (token: TokenDiscovery) => {
        this.handleTokenDiscovery(token, name);
      });
      
      // Handle enhanced token discovery if available
      monitor.on('enhancedTokenDiscovered', (token: any) => {
        this.handleTokenDiscovery(token, name);
      });
      
      monitor.on('error', (error: Error) => {
        logger.error(`Monitor ${name} error:`, error);
        this.emit('monitorError', { monitor: name, error });
      });
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('DiscoveryManager is already running');
      return;
    }

    logger.info('Starting DiscoveryManager...');
    this.isRunning = true;
    
    // Start all monitors
    const startPromises = Array.from(this.monitors.entries()).map(([name, monitor]) => {
      return monitor.start().catch(error => {
        logger.error(`Failed to start monitor ${name}:`, error);
      });
    });
    
    await Promise.all(startPromises);
    
    logger.info('All monitors started successfully');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('DiscoveryManager is not running');
      return;
    }

    logger.info('Stopping DiscoveryManager...');
    this.isRunning = false;
    
    // Stop all monitors
    const stopPromises = Array.from(this.monitors.entries()).map(([name, monitor]) => {
      return monitor.stop().catch(error => {
        logger.error(`Failed to stop monitor ${name}:`, error);
      });
    });
    
    await Promise.all(stopPromises);
    
    // Clear the queue
    this.queue.clear();
    await this.queue.onIdle();
    
    logger.info('DiscoveryManager stopped');
    this.emit('stopped');
  }

  private async handleTokenDiscovery(token: TokenDiscovery, source: string): Promise<void> {
    // Check if we've already processed this token
    if (this.processedTokens.has(token.address)) {
      logger.debug(`Token ${token.address} already processed, skipping`);
      return;
    }
    
    // Check deduplication service
    const isDuplicate = await this.deduplicationService.isDuplicate(token.address);
    if (isDuplicate) {
      logger.debug(`Token ${token.address} is a duplicate, skipping`);
      return;
    }
    
    // Add to processed set
    this.processedTokens.add(token.address);
    
    // Add to processing queue
    this.queue.add(async () => {
      try {
        logger.info(`Processing discovered token: ${token.symbol} (${token.address}) from ${source}`);
        
        // Store the token in database using the adapter
        await this.storageAdapter.storeDiscoveredToken(token);
        
        // Process the token (analysis, enrichment, etc.)
        await this.tokenProcessor.processDiscoveredToken(token);
        
        // Mark as processed in deduplication service
        await this.deduplicationService.markAsProcessed(token.address);
        
        // Emit event for successful processing
        this.emit('tokenProcessed', {
          token,
          source,
          timestamp: new Date(),
        });
        
        // Log pump.fun specific info if available
        if (token.platform === 'pumpfun' && token.metadata) {
          const metadata = token.metadata;
          if (metadata.initialPrice || metadata.curveProgress) {
            logger.info(`PumpFun token metrics - Price: ${metadata.initialPrice?.toFixed(8) || 'N/A'} SOL, Progress: ${metadata.curveProgress || 0}%`);
          }
        }
        
      } catch (error) {
        logger.error(`Failed to process token ${token.address}:`, error);
        
        this.emit('tokenProcessingError', {
          token,
          source,
          error,
        });
      }
    });
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    size: number;
    pending: number;
    isPaused: boolean;
  } {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Get monitor statuses
   */
  getMonitorStatuses(): Map<string, boolean> {
    const statuses = new Map<string, boolean>();
    this.monitors.forEach((monitor, name) => {
      statuses.set(name, monitor.isRunning || false);
    });
    return statuses;
  }

  /**
   * Restart a specific monitor
   */
  async restartMonitor(name: string): Promise<void> {
    const monitor = this.monitors.get(name);
    if (!monitor) {
      throw new Error(`Monitor ${name} not found`);
    }
    
    logger.info(`Restarting monitor ${name}...`);
    await monitor.stop();
    await monitor.start();
    logger.info(`Monitor ${name} restarted successfully`);
  }

  /**
   * Get recent pump.fun tokens
   */
  async getRecentPumpFunTokens(limit: number = 50): Promise<any[]> {
    return this.storageAdapter.getRecentPumpFunTokens(limit);
  }

  /**
   * Clear processed tokens cache (useful for testing)
   */
  clearProcessedCache(): void {
    this.processedTokens.clear();
    logger.info('Cleared processed tokens cache');
  }
}