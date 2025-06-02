// src/discovery/discovery-service.ts
import { logger } from '../utils/logger';
import { FilteredDiscoveryManager } from './filtered-discovery-manager';
import { EnhancedPumpFunMonitor as PumpFunMonitor } from './pumpfun-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { categoryManager } from '../category/category-manager';
import { scanScheduler } from '../category/scan-scheduler';
//import { registerTemporaryScanHandlers } from '../category/temp-scan-handler';

export class DiscoveryService {
  private discoveryManager: FilteredDiscoveryManager;
  private pumpFunMonitor: PumpFunMonitor;
  private raydiumMonitor: RaydiumMonitor;
  private isRunning: boolean = false;

  constructor() {
    this.discoveryManager = new FilteredDiscoveryManager();
    this.pumpFunMonitor = new PumpFunMonitor();
    this.raydiumMonitor = new RaydiumMonitor();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing discovery service with category system');
    
    // Initialize components
    await this.discoveryManager.initialize();
    
    // Register monitors
    this.discoveryManager.registerMonitor(this.pumpFunMonitor);
    this.discoveryManager.registerMonitor(this.raydiumMonitor);
    
    // Set up category manager listeners
    categoryManager.on('categoryChange', async (event) => {
      logger.info(`Category change: ${event.tokenAddress} ${event.fromCategory} → ${event.toCategory}`);
      
      // Update scan scheduler
      await scanScheduler.handleCategoryChange(
        event.tokenAddress,
        event.fromCategory,
        event.toCategory
      );
    });
    
    categoryManager.on('aimEntry', async (event) => {
      logger.info(`🎯 AIM entry: ${event.tokenAddress}`);
      // Could trigger immediate analysis here
    });
    
    // Start scan scheduler
    await scanScheduler.start();
    
    // Register temporary handlers to prevent errors
    //registerTemporaryScanHandlers();
    
    logger.info('Discovery service initialized with category system');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Discovery service is already running');
      return;
    }

    logger.info('Starting discovery service...');
    await this.discoveryManager.startAll();
    this.isRunning = true;
    logger.info('Discovery service started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Discovery service is not running');
      return;
    }

    logger.info('Stopping discovery service...');
    await this.discoveryManager.stopAll();
    await scanScheduler.stop();
    this.isRunning = false;
    logger.info('Discovery service stopped');
  }

  getStats() {
    const stats = this.discoveryManager.getStats();
    const categoryStats = categoryManager.getStats();
    const scanStats = scanScheduler.getStats();
    
    return {
      discovery: stats,
      categories: categoryStats,
      scanning: scanStats,
      isRunning: this.isRunning
    };
  }
}

// Create singleton instance
const discoveryService = new DiscoveryService();

// Create instances needed by other parts
const pumpFunMonitor = new PumpFunMonitor();
const raydiumMonitor = new RaydiumMonitor();

export { discoveryService, pumpFunMonitor, raydiumMonitor };
