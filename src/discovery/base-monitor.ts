import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface TokenDiscovery {
  address: string;
  symbol: string;
  name: string;
  platform: string;
  createdAt: Date;
  metadata?: any;
}

export abstract class BaseMonitor extends EventEmitter {
  protected name: string;
  protected isRunning: boolean = false;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 10;
  protected reconnectDelay: number = 5000;

  constructor(name: string) {
    super();
    this.name = name;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn(`Monitor ${this.name} is already running`);
      return;
    }

    logger.info(`Starting ${this.name} monitor`);
    this.isRunning = true;
    
    try {
      await this.startMonitoring();
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error(`Failed to start ${this.name} monitor`, error);
      await this.handleReconnect();
    }
  }

  async stop(): Promise<void> {
    logger.info(`Stopping ${this.name} monitor`);
    this.isRunning = false;
    await this.stopMonitoring();
  }

  protected abstract startMonitoring(): Promise<void>;
  protected abstract stopMonitoring(): Promise<void>;

  protected async handleReconnect(): Promise<void> {
    if (!this.isRunning) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts reached for ${this.name}`);
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    logger.info(`Reconnecting ${this.name} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.start();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  protected emitTokenDiscovery(token: TokenDiscovery): void {
    logger.debug(`Token discovered on ${this.name}:`, {
      address: token.address,
      symbol: token.symbol,
      platform: token.platform
    });
    
    this.emit('tokenDiscovered', token);
  }
}