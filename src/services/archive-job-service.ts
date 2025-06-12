// src/services/archive-job-service.ts
// Service to archive tokens that have been below $8k for 48 hours

import { EventEmitter } from 'events';
import { db } from '../database/postgres';
import { logger } from '../utils/logger2';
import { categoryConfig } from '../config/category-config';
import { CategoryManager } from '../category/category-manager';

export interface ArchiveCandidate {
  address: string;
  symbol: string;
  name: string;
  market_cap: number;
  below_8k_since: Date;
  hours_below_threshold: number | string; // Can be string from DB
  category: string;
}

export interface ArchiveCompleteEvent {
  tokensArchived: number;
  duration: number;
  timestamp: Date;
}

export interface TokenArchivedEvent {
  address: string;
  symbol: string;
  name: string;
  previousCategory: string;
  marketCap: number;
  hoursBelowThreshold: number;
  timestamp: Date;
}

export class ArchiveJobService extends EventEmitter {
  private isRunning: boolean = false;
  private checkInterval?: NodeJS.Timeout;
  private categoryManager: CategoryManager;

  constructor(categoryManager: CategoryManager) {
    super();
    this.categoryManager = categoryManager;
  }

  /**
   * Start the archive job service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Archive job service is already running');
      return;
    }

    logger.info('🗄️ Starting Archive Job Service...');
    this.isRunning = true;

    // Run initial check
    await this.checkForTokensToArchive();

    // Set up interval check
    const intervalMs = categoryConfig.archiveSettings.checkIntervalMinutes * 60 * 1000;
    this.checkInterval = setInterval(async () => {
      await this.checkForTokensToArchive();
    }, intervalMs);

    logger.info(`✅ Archive Job Service started - checking every ${categoryConfig.archiveSettings.checkIntervalMinutes} minutes`);
  }

  /**
   * Stop the archive job service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping Archive Job Service...');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    this.isRunning = false;
    logger.info('✅ Archive Job Service stopped');
  }

  /**
   * Check for tokens that should be archived
   */
  private async checkForTokensToArchive(): Promise<void> {
    try {
      const startTime = Date.now();
      logger.info('🔍 Checking for tokens to archive...');

      // Find tokens that have been below $8k for more than configured hours
      const hoursThreshold = categoryConfig.archiveSettings.belowThresholdHours;
      const cutoffTime = new Date(Date.now() - (hoursThreshold * 60 * 60 * 1000));

      const candidates = await db('tokens')
        .where('below_8k_since', '<=', cutoffTime)
        .where('category', '!=', 'ARCHIVE')
        .where('category', '!=', 'BIN')
        .where('category', '!=', 'COMPLETE')
        .whereNotNull('below_8k_since')
        .select([
          'address',
          'symbol',
          'name',
          'market_cap',
          'below_8k_since',
          'category',
          db.raw(`EXTRACT(EPOCH FROM (NOW() - below_8k_since)) / 3600 AS hours_below_threshold`)
        ]);

      if (candidates.length === 0) {
        logger.info('✅ No tokens to archive');
        return;
      }

      logger.info(`📊 Found ${candidates.length} tokens to archive`);

      // Archive each token
      for (const token of candidates) {
        await this.archiveToken(token);
      }

      const duration = Date.now() - startTime;
      logger.info(`✅ Archive check completed in ${duration}ms - Archived ${candidates.length} tokens`);

      // Emit summary event
      const archiveCompleteEvent: ArchiveCompleteEvent = {
        tokensArchived: candidates.length,
        duration,
        timestamp: new Date()
      };
      this.emit('archiveComplete', archiveCompleteEvent);

    } catch (error) {
      logger.error('Error checking for tokens to archive:', error);
      this.emit('error', error);
    }
  }

  /**
   * Archive a specific token
   */
  private async archiveToken(token: ArchiveCandidate): Promise<void> {
    try {
      const displaySymbol = token.symbol && token.symbol !== 'LOADING...' 
        ? token.symbol 
        : token.address.substring(0, 8) + '...';

      logger.info(`🗄️ Archiving ${displaySymbol} - Below $8k for ${Number(token.hours_below_threshold).toFixed(1)} hours`);

      // Start transaction
      await db.transaction(async (trx) => {
        // Update token category to ARCHIVE
        await trx('tokens')
          .where('address', token.address)
          .update({
            category: 'ARCHIVE',
            previous_category: token.category,
            category_updated_at: new Date(),
            archive_reason: 'below_threshold_48h',
            archived_at: new Date(),
            updated_at: new Date()
          });

        // Record category transition
        await trx('category_transitions').insert({
          token_address: token.address,
          from_category: token.category,
          to_category: 'ARCHIVE',
          market_cap_at_transition: token.market_cap,
          reason: 'below_8k_for_48h',
          metadata: {
            below_8k_since: token.below_8k_since,
            hours_below_threshold: Number(token.hours_below_threshold)
          },
          created_at: new Date()
        });
      });

      // Update category manager
      await this.categoryManager.updateTokenCategory(token.address, 'ARCHIVE', token.market_cap);

      // Emit archive event
      const tokenArchivedEvent: TokenArchivedEvent = {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        previousCategory: token.category,
        marketCap: token.market_cap,
        hoursBelowThreshold: Number(token.hours_below_threshold),
        timestamp: new Date()
      };
      this.emit('tokenArchived', tokenArchivedEvent);

      logger.info(`✅ Successfully archived ${displaySymbol}`);

    } catch (error) {
      logger.error(`Error archiving token ${token.address}:`, error);
      throw error;
    }
  }

  /**
   * Manually archive tokens (for testing/admin)
   */
  async manualArchiveCheck(): Promise<number> {
    logger.info('🔧 Running manual archive check...');
    await this.checkForTokensToArchive();
    
    // Return count of archived tokens
    const result = await db('category_transitions')
      .where('to_category', 'ARCHIVE')
      .where('reason', 'below_8k_for_48h')
      .where('created_at', '>', new Date(Date.now() - 60000)) // Last minute
      .count('* as count')
      .first();

    return Number(result?.count || 0);
  }

  /**
   * Get archive statistics
   */
  async getArchiveStats(): Promise<any> {
    const [totalArchived, recentlyArchived, candidatesCount] = await Promise.all([
      // Total archived tokens
      db('tokens')
        .where('category', 'ARCHIVE')
        .where('archive_reason', 'below_threshold_48h')
        .count('* as count')
        .first(),

      // Recently archived (last 24h)
      db('category_transitions')
        .where('to_category', 'ARCHIVE')
        .where('reason', 'below_8k_for_48h')
        .where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count')
        .first(),

      // Current candidates
      db('tokens')
        .where('market_cap', '<', categoryConfig.thresholds.MIN_MARKET_CAP)
        .whereNotNull('below_8k_since')
        .whereNotIn('category', ['ARCHIVE', 'BIN', 'COMPLETE'])
        .count('* as count')
        .first()
    ]);

    return {
      totalArchived: Number(totalArchived?.count || 0),
      archivedLast24h: Number(recentlyArchived?.count || 0),
      currentCandidates: Number(candidatesCount?.count || 0),
      checkIntervalMinutes: categoryConfig.archiveSettings.checkIntervalMinutes,
      thresholdHours: categoryConfig.archiveSettings.belowThresholdHours,
      minMarketCap: categoryConfig.thresholds.MIN_MARKET_CAP,
      isRunning: this.isRunning
    };
  }

  /**
   * Get tokens currently below threshold
   */
  async getTokensBelowThreshold(): Promise<any[]> {
    const tokens = await db('tokens')
      .where('market_cap', '<', categoryConfig.thresholds.MIN_MARKET_CAP)
      .whereNotNull('below_8k_since')
      .whereNotIn('category', ['ARCHIVE', 'BIN', 'COMPLETE'])
      .select([
        'address',
        'symbol',
        'name',
        'market_cap',
        'category',
        'below_8k_since',
        db.raw(`EXTRACT(EPOCH FROM (NOW() - below_8k_since)) / 3600 AS hours_below_threshold`),
        db.raw(`${categoryConfig.archiveSettings.belowThresholdHours} - EXTRACT(EPOCH FROM (NOW() - below_8k_since)) / 3600 AS hours_until_archive`)
      ])
      .orderBy('below_8k_since', 'asc');

    return tokens.map(token => ({
      ...token,
      hours_below_threshold: Number(token.hours_below_threshold || 0),
      hours_until_archive: Math.max(0, Number(token.hours_until_archive || 0)),
      will_archive_at: new Date(token.below_8k_since.getTime() + (categoryConfig.archiveSettings.belowThresholdHours * 60 * 60 * 1000))
    }));
  }
}

// Export singleton instance
export const ARCHIVE_JOB_SERVICE = new ArchiveJobService(new CategoryManager());