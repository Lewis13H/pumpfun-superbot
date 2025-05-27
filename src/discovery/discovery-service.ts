// src/discovery/discovery-service.ts
import { EventEmitter } from 'events';
import { DiscoveryManager } from './discovery-manager';
import { TokenProcessor } from './token-processor';
import { DeduplicationService } from './deduplication-service';
import { PumpFunMonitor } from './pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { logger } from '../utils/logger';

export class DiscoveryService extends EventEmitter {
  private discoveryManager: DiscoveryManager;
  private tokenProcessor: TokenProcessor;
  private deduplicationService: DeduplicationService;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.discoveryManager = new DiscoveryManager();
    this.tokenProcessor = new TokenProcessor();
    this.deduplicationService = new DeduplicationService();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Discovery Service');

    // Initialize discovery manager
    await this.discoveryManager.initialize();

    // Set up event handlers
    this.setupEventHandlers();

    // Register monitors
    this.discoveryManager.registerMonitor(new PumpFunMonitor());
    this.discoveryManager.registerMonitor(new RaydiumMonitor());

    logger.info('Discovery Service initialized');
  }

  private setupEventHandlers(): void {
    // Handle discovered tokens
    this.discoveryManager.on('tokenDiscovered', async (token) => {
      // Check for duplicates
      if (this.deduplicationService.isDuplicate(token.address, token.platform)) {
        logger.debug(`Duplicate token filtered: ${token.address}`);
        return;
      }

      // Calculate priority based on platform and age
      const priority = this.calculatePriority(token);

      // Add to processing queue
      await this.tokenProcessor.addToken(token, priority);
    });

    // Handle processed tokens - emit to parent service
    this.tokenProcessor.on('tokenReady', (token) => {
      logger.info(`Token ready for analysis: ${token.symbol} (${token.address})`);
      // Emit the event so the analysis service can pick it up
      this.emit('tokenReady', token);
    });

    // Handle failed tokens
    this.tokenProcessor.on('tokenFailed', (token, error) => {
      logger.error(`Token processing failed: ${token.address}`, error);
    });
  }

  private calculatePriority(token: any): number {
    let priority = 50; // Base priority

    // Platform priorities
    if (token.platform === 'pumpfun') priority += 20;
    if (token.platform === 'raydium') priority += 15;

    // Age priority (newer = higher)
    const ageMinutes = (Date.now() - new Date(token.createdAt).getTime()) / 60000;
    if (ageMinutes < 5) priority += 30;
    else if (ageMinutes < 15) priority += 20;
    else if (ageMinutes < 60) priority += 10;

    // Market cap priority (if available)
    if (token.metadata?.marketCap) {
      if (token.metadata.marketCap < 100000) priority += 15;
      else if (token.metadata.marketCap < 500000) priority += 10;
    }

    return Math.min(100, Math.max(0, priority));
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Discovery Service is already running');
      return;
    }

    logger.info('Starting Discovery Service');
    this.isRunning = true;

    // Start all monitors
    await this.discoveryManager.startAll();

    logger.info('Discovery Service started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Discovery Service is not running');
      return;
    }

    logger.info('Stopping Discovery Service');
    this.isRunning = false;

    // Stop all monitors
    await this.discoveryManager.stopAll();

    // Clear processing queue
    await this.tokenProcessor.clear();

    // Stop deduplication service
    this.deduplicationService.stop();

    logger.info('Discovery Service stopped');
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      discovery: this.discoveryManager.getStats(),
      processing: this.tokenProcessor.getStats(),
      deduplication: this.deduplicationService.getStats(),
    };
  }
}

// Export singleton instance
export const discoveryService = new DiscoveryService();