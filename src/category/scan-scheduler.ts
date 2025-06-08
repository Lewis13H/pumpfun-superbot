import { EventEmitter } from 'events';
import { TokenCategory, categoryConfig } from '../config/category-config';
import { ScanTask, ScanResult, ScanSchedule } from './scan-task.interface';
import { categoryManager } from './category-manager';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import * as cron from 'node-cron';

export class ScanScheduler extends EventEmitter {
  private schedules: Map<TokenCategory, ScanSchedule> = new Map();
  private activeTasks: Map<string, ScanTask> = new Map();
  private cronJobs: Map<TokenCategory, cron.ScheduledTask> = new Map();
  private scanHandlers: Map<TokenCategory, (task: ScanTask) => Promise<ScanResult>> = new Map();
  
  constructor() {
    super();
    this.initializeSchedules();
  }
  
  /**
   * Initialize schedules for each category
   */
  private initializeSchedules(): void {
    const categories: TokenCategory[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE'];
    
    categories.forEach(category => {
      this.schedules.set(category, {
        category,
        tasks: [],
        activeScans: 0,
        completedScans: 0,
        failedScans: 0,
      });
    });
  }
  
  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    logger.info('Starting Scan Scheduler...');
    
    // Load existing tokens
    await this.loadExistingTokens();
    
    // Start cron jobs for each category
    this.startCategorySchedulers();
    
    // Start timeout checker
    this.startTimeoutChecker();
    
    logger.info('Scan Scheduler started');
  }
  
  /**
   * Load existing tokens into schedules
   */
  private async loadExistingTokens(): Promise<void> {
    const tokens = await db('tokens')
      .whereNotIn('category', ['BIN', 'COMPLETE'])
      .select('address', 'category', 'category_scan_count', 'last_scan_at');
    
    for (const token of tokens) {
      await this.scheduleToken(
        token.address,
        token.category as TokenCategory,
        token.category_scan_count || 0
      );
    }
    
    logger.info(`Loaded ${tokens.length} tokens into scan schedules`);
  }
  
  /**
   * Schedule a token for scanning
   */
  async scheduleToken(
    tokenAddress: string,
    category: TokenCategory,
    existingScanCount: number = 0
  ): Promise<void> {
    // Don't schedule BIN tokens
    if (category === 'BIN') return;
    
    const schedule = this.schedules.get(category);
    if (!schedule) return;
    
    const config = categoryConfig.scanIntervals[category];
    const now = new Date();
    
    const task: ScanTask = {
      tokenAddress,
      category,
      scanNumber: existingScanCount,
      startedAt: now,
      nextScanAt: new Date(now.getTime() + config.interval * 1000),
      timeoutAt: new Date(now.getTime() + config.duration * 1000),
      priority: this.calculatePriority(category, existingScanCount),
    };
    
    // Remove from other schedules if exists
    this.removeFromAllSchedules(tokenAddress);
    
    // Add to new schedule
    schedule.tasks.push(task);
    this.activeTasks.set(tokenAddress, task);
    
    logger.debug(`Scheduled ${tokenAddress} for ${category} scanning`);
  }
  
  /**
   * Remove token from all schedules
   */
  private removeFromAllSchedules(tokenAddress: string): void {
    for (const [category, schedule] of this.schedules) {
      schedule.tasks = schedule.tasks.filter(t => t.tokenAddress !== tokenAddress);
    }
    this.activeTasks.delete(tokenAddress);
  }
  
  /**
   * Calculate scan priority
   */
  private calculatePriority(category: TokenCategory, scanNumber: number): number {
    const basePriorities: Record<TokenCategory, number> = {
      AIM: 100,
      HIGH: 80,
      MEDIUM: 60,
      NEW: 50,
      LOW: 30,
      ARCHIVE: 10,
      BIN: 0,
      COMPLETE: 0,
    };
    
    // Reduce priority as scan count increases
    return basePriorities[category] - scanNumber;
  }
  
  /**
   * Start category-specific schedulers
   */
  private startCategorySchedulers(): void {
    for (const [category, config] of Object.entries(categoryConfig.scanIntervals)) {
      if (category === 'BIN' || config.interval === 0) continue;
      
      const cat = category as TokenCategory;
      
      // For AIM, use setInterval due to 10-second frequency
      if (cat === 'AIM') {
        const intervalId = setInterval(() => {
          this.processCategoryScans(cat);
        }, config.interval * 1000);
        
        // Store as cron job for consistency
        this.cronJobs.set(cat, { stop: () => clearInterval(intervalId) } as any);
      } else {
        // Use cron for longer intervals
        const cronExpression = this.intervalToCron(config.interval);
        const job = cron.schedule(cronExpression, () => {
          this.processCategoryScans(cat);
        });
        
        this.cronJobs.set(cat, job);
        job.start();
      }
      
      logger.info(`Started scheduler for ${cat} (every ${config.interval}s)`);
    }
  }
  
  /**
   * Convert interval to cron expression
   */
  private intervalToCron(seconds: number): string {
    if (seconds < 60) {
      return `*/${seconds} * * * * *`; // Every N seconds
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `*/${minutes} * * * *`; // Every N minutes
    } else {
      const hours = Math.floor(seconds / 3600);
      return `0 */${hours} * * *`; // Every N hours
    }
  }
  
  /**
   * Process scans for a category
   */
  private async processCategoryScans(category: TokenCategory): Promise<void> {
    const schedule = this.schedules.get(category);
    if (!schedule) return;
    
    const now = new Date();
    const dueTasks = schedule.tasks.filter(t => t.nextScanAt <= now);
    
    if (dueTasks.length === 0) return;
    
    logger.debug(`Processing ${dueTasks.length} ${category} scans`);
    
    // Sort by priority
    dueTasks.sort((a, b) => b.priority - a.priority);
    
    // Process in batches based on category
    const batchSize = this.getBatchSize(category);
    const batch = dueTasks.slice(0, batchSize);
    
    for (const task of batch) {
      await this.executeScan(task);
    }
  }
  
  /**
   * Get batch size for category
   */
  private getBatchSize(category: TokenCategory): number {
    const batchSizes: Record<TokenCategory, number> = {
      AIM: 20,
      HIGH: 50,
      MEDIUM: 30,
      NEW: 20,
      LOW: 10,
      ARCHIVE: 5,
      BIN: 0,
      COMPLETE: 0,
    };
    return batchSizes[category] || 10;
  }
  
  /**
   * Execute a scan
   */
  private async executeScan(task: ScanTask): Promise<void> {
    const schedule = this.schedules.get(task.category);
    if (!schedule) return;
    
    schedule.activeScans++;
    task.lastScanAt = new Date();
    task.scanNumber++;
    
    try {
      // Get the scan handler for this category
      const handler = this.scanHandlers.get(task.category);
      if (!handler) {
        throw new Error(`No scan handler registered for ${task.category}`);
      }
      
      // Execute scan
      const startTime = Date.now();
      const result = await handler(task);
      
      // Update task
      task.nextScanAt = new Date(Date.now() + categoryConfig.scanIntervals[task.category].interval * 1000);
      
      // Record scan in database
      await this.recordScan(task, result);
      
      // Notify category manager
      await categoryManager.recordScanComplete(task.tokenAddress);
      
      // Check if market cap changed categories
      if (result.marketCap !== undefined) {
        await categoryManager.updateTokenMarketCap(task.tokenAddress, result.marketCap);
      }
      
      schedule.completedScans++;
      
      // Emit scan complete event
      this.emit('scanComplete', {
        task,
        result,
      });
      
      // Check if this was the final scan
      const config = categoryConfig.scanIntervals[task.category];
      if (task.scanNumber >= config.maxScans) {
        logger.info(`Token ${task.tokenAddress} completed max scans in ${task.category}`);
        this.removeFromAllSchedules(task.tokenAddress);
      }
      
    } catch (error) {
      logger.error(`Scan failed for ${task.tokenAddress}:`, error);
      schedule.failedScans++;
      
      // Emit scan failed event
      this.emit('scanFailed', {
        task,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      schedule.activeScans--;
    }
  }
  
  /**
   * Record scan in database
   */
  private async recordScan(task: ScanTask, result: ScanResult): Promise<void> {
    await db('scan_logs').insert({
      token_address: task.tokenAddress,
      category: task.category,
      scan_number: task.scanNumber,
      scan_duration_ms: result.duration,
      apis_called: JSON.stringify(result.apisUsed),
      api_costs: JSON.stringify({}), // TODO: Calculate costs
      errors: result.error ? JSON.stringify({ error: result.error }) : null,
      is_final_scan: task.scanNumber >= categoryConfig.scanIntervals[task.category].maxScans,
      created_at: new Date(),
    });
    
    // Update token last scan
    await db('tokens')
      .where('address', task.tokenAddress)
      .update({
        last_scan_at: new Date(),
        category_scan_count: task.scanNumber,
      });
  }
  
  /**
   * Register scan handler for a category
   */
  registerScanHandler(
    category: TokenCategory,
    handler: (task: ScanTask) => Promise<ScanResult>
  ): void {
    this.scanHandlers.set(category, handler);
    logger.info(`Registered scan handler for ${category}`);
  }
  
  /**
   * Start timeout checker
   */
  private startTimeoutChecker(): void {
    setInterval(() => {
      const now = new Date();
      
      for (const [tokenAddress, task] of this.activeTasks) {
        if (task.timeoutAt <= now) {
          logger.info(`Token ${tokenAddress} timed out in ${task.category}`);
          
          // Notify category manager
          categoryManager.recordScanComplete(tokenAddress);
          
          // Remove from schedules
          this.removeFromAllSchedules(tokenAddress);
          
          // Emit timeout event
          this.emit('tokenTimeout', {
            tokenAddress,
            category: task.category,
            scanCount: task.scanNumber,
          });
        }
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Handle category change
   */
  async handleCategoryChange(
    tokenAddress: string,
    fromCategory: TokenCategory,
    toCategory: TokenCategory
  ): Promise<void> {
    // Remove from old schedule
    this.removeFromAllSchedules(tokenAddress);
    
    // Add to new schedule if not terminal
    if (toCategory !== 'BIN' && toCategory !== 'COMPLETE') {
      await this.scheduleToken(tokenAddress, toCategory);
    }
  }
  
  /**
   * Get statistics
   */
  getStats(): Record<TokenCategory, any> {
    const stats: Record<TokenCategory, any> = {} as any;
    
    for (const [category, schedule] of this.schedules) {
      stats[category] = {
        totalTasks: schedule.tasks.length,
        activeScans: schedule.activeScans,
        completedScans: schedule.completedScans,
        failedScans: schedule.failedScans,
        nextScans: schedule.tasks
          .filter(t => t.nextScanAt)
          .sort((a, b) => a.nextScanAt.getTime() - b.nextScanAt.getTime())
          .slice(0, 5)
          .map(t => ({
            token: t.tokenAddress,
            nextScan: t.nextScanAt,
            scanNumber: t.scanNumber,
          })),
      };
    }
    
    return stats;
  }
  
  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    // Stop all cron jobs
    for (const [category, job] of this.cronJobs) {
      job.stop();
    }
    
    this.cronJobs.clear();
    this.schedules.clear();
    this.activeTasks.clear();
    
    logger.info('Scan Scheduler stopped');
  }
}

// Export singleton instance
export const scanScheduler = new ScanScheduler();


