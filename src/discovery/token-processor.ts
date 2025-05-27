import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TokenDiscovery } from './base-monitor';
import { config } from '../config';

export interface ProcessingTask {
  id: string;
  token: TokenDiscovery;
  priority: number;
  createdAt: Date;
  attempts: number;
}

export class TokenProcessor extends EventEmitter {
  private queue: PQueue;
  private processing: Map<string, ProcessingTask> = new Map();
  private stats = {
    processed: 0,
    failed: 0,
    skipped: 0,
    currentQueueSize: 0,
  };

  constructor() {
    super();
    
    this.queue = new PQueue({
      concurrency: config.discovery.maxConcurrentProcessing,
      timeout: 30000, // 30 second timeout per task
    });

    this.queue.on('active', () => {
      this.stats.currentQueueSize = this.queue.size;
      logger.debug(`Processing queue active. Size: ${this.queue.size}, Pending: ${this.queue.pending}`);
    });

    this.queue.on('idle', () => {
      logger.debug('Processing queue idle');
    });
  }

  async addToken(token: TokenDiscovery, priority: number = 50): Promise<void> {
    if (this.queue.size >= config.discovery.discoveryQueueSize) {
      logger.warn('Processing queue full, dropping token', {
        address: token.address,
        queueSize: this.queue.size,
      });
      this.stats.skipped++;
      return;
    }

    const task: ProcessingTask = {
      id: `${token.address}-${Date.now()}`,
      token,
      priority,
      createdAt: new Date(),
      attempts: 0,
    };

    await this.queue.add(
      async () => this.processToken(task),
      { priority }
    );
  }

  private async processToken(task: ProcessingTask): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Processing token: ${task.token.symbol} (${task.token.address})`);
      this.processing.set(task.token.address, task);

      // For now, just validate and emit for further processing
      // Module 1C will add actual analysis here
      await this.validateToken(task.token);
      
      // Emit for analysis pipeline
      this.emit('tokenReady', task.token);
      
      this.stats.processed++;
      
      const duration = Date.now() - startTime;
      logger.info(`Token processed: ${task.token.symbol} in ${duration}ms`);
    } catch (error) {
      this.stats.failed++;
      logger.error(`Failed to process token ${task.token.address}:`, error);
      
      // Retry logic
      if (task.attempts < 3) {
        task.attempts++;
        logger.info(`Retrying token ${task.token.address} (attempt ${task.attempts})`);
        await this.addToken(task.token, task.priority - 10);
      } else {
        this.emit('tokenFailed', task.token, error);
      }
    } finally {
      this.processing.delete(task.token.address);
    }
  }

  private async validateToken(token: TokenDiscovery): Promise<void> {
    // Basic validation
    if (!token.address || token.address.length < 32) {
      throw new Error('Invalid token address');
    }

    if (!token.symbol || token.symbol.length === 0) {
      throw new Error('Missing token symbol');
    }

    if (!token.platform) {
      throw new Error('Missing platform');
    }

    // Additional validation can be added here
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.size,
      pending: this.queue.pending,
      isRunning: !this.queue.isPaused,
    };
  }

  async pause(): Promise<void> {
    this.queue.pause();
    logger.info('Token processor paused');
  }

  async resume(): Promise<void> {
    this.queue.start();
    logger.info('Token processor resumed');
  }

  async clear(): Promise<void> {
    await this.queue.clear();
    logger.info('Token processor queue cleared');
  }
}