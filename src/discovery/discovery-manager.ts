import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { BaseMonitor, TokenDiscovery } from './base-monitor';
import { db } from '../database/postgres';
import { writeDiscoveryEvent } from '../database/questdb';

export class DiscoveryManager extends EventEmitter {
  private monitors: Map<string, BaseMonitor> = new Map();
  private discoveredTokens: Set<string> = new Set();
  private stats = {
    totalDiscovered: 0,
    duplicatesFound: 0,
    errorsEncountered: 0,
  };

  async initialize(): Promise<void> {
    logger.info('Initializing Discovery Manager');
    
    // Load existing tokens to prevent re-discovery
    await this.loadExistingTokens();
  }

  registerMonitor(monitor: BaseMonitor): void {
    const monitorName = monitor.constructor.name;
    
    if (this.monitors.has(monitorName)) {
      logger.warn(`Monitor ${monitorName} already registered`);
      return;
    }

    // Set up event handlers
    monitor.on('tokenDiscovered', async (token: TokenDiscovery) => {
      await this.handleTokenDiscovery(token);
    });

    monitor.on('error', (error: Error) => {
      logger.error(`Monitor error from ${monitorName}:`, error);
      this.stats.errorsEncountered++;
    });

    this.monitors.set(monitorName, monitor);
    logger.info(`Registered monitor: ${monitorName}`);
  }

  async startAll(): Promise<void> {
    logger.info('Starting all monitors');
    
    const startPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.start().catch(error => {
        logger.error(`Failed to start monitor:`, error);
      })
    );

    await Promise.all(startPromises);
    logger.info(`Started ${this.monitors.size} monitors`);
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping all monitors');
    
    const stopPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.stop().catch(error => {
        logger.error(`Failed to stop monitor:`, error);
      })
    );

    await Promise.all(stopPromises);
    logger.info('All monitors stopped');
  }

  private async loadExistingTokens(): Promise<void> {
    try {
      const existingTokens = await db('tokens')
        .select('address')
        .limit(10000);
      
      existingTokens.forEach(token => {
        this.discoveredTokens.add(token.address);
      });
      
      logger.info(`Loaded ${existingTokens.length} existing tokens`);
    } catch (error) {
      logger.error('Failed to load existing tokens:', error);
    }
  }

  private async handleTokenDiscovery(token: TokenDiscovery): Promise<void> {
    // Check for duplicates
    if (this.discoveredTokens.has(token.address)) {
      this.stats.duplicatesFound++;
      logger.debug(`Duplicate token found: ${token.address}`);
      return;
    }

    // Mark as discovered
    this.discoveredTokens.add(token.address);
    this.stats.totalDiscovered++;

    // Store in database
    try {
      await db('tokens').insert({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        platform: token.platform,
        created_at: token.createdAt,
        discovered_at: new Date(),
        raw_data: JSON.stringify(token.metadata || {}),
      }).onConflict('address').ignore();

      // Write to QuestDB
      await writeDiscoveryEvent({
        tokenAddress: token.address,
        platform: token.platform,
        eventType: 'discovered',
        details: `${token.symbol} - ${token.name}`,
      });

      // Emit for further processing
      this.emit('tokenDiscovered', token);
      
      logger.info(`New token discovered: ${token.symbol} (${token.address}) on ${token.platform}`);
    } catch (error) {
      logger.error('Failed to save discovered token:', error);
      this.stats.errorsEncountered++;
    }
  }

  getStats() {
    return {
      ...this.stats,
      monitorsActive: this.monitors.size,
      uniqueTokens: this.discoveredTokens.size,
    };
  }
}