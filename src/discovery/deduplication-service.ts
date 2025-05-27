import { logger } from '../utils/logger';
import crypto from 'crypto';

export class DeduplicationService {
  private seenTokens: Map<string, Set<string>> = new Map();
  private tokenHashes: Map<string, string> = new Map();
  private maxAge: number = 3600000; // 1 hour
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup old entries every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 600000);
  }

  stop(): void {
    clearInterval(this.cleanupInterval);
  }

  isDuplicate(address: string, platform: string): boolean {
    const normalizedAddress = address.toLowerCase();
    
    // Check if we've seen this token on any platform
    const platforms = this.seenTokens.get(normalizedAddress);
    
    if (!platforms) {
      // First time seeing this token
      this.seenTokens.set(normalizedAddress, new Set([platform]));
      this.tokenHashes.set(normalizedAddress, this.generateHash(normalizedAddress));
      return false;
    }

    // We've seen this token before
    if (platforms.has(platform)) {
      // Same token on same platform - definite duplicate
      return true;
    } else {
      // Same token on different platform - might be legitimate
      platforms.add(platform);
      logger.info(`Token ${address} discovered on multiple platforms: ${Array.from(platforms).join(', ')}`);
      return false; // Allow it but log it
    }
  }

  generateHash(address: string): string {
    return crypto
      .createHash('sha256')
      .update(address.toLowerCase())
      .digest('hex')
      .substring(0, 16);
  }

  getStats(): any {
    const platformStats: Record<string, number> = {};
    
    for (const [, platforms] of this.seenTokens) {
      for (const platform of platforms) {
        platformStats[platform] = (platformStats[platform] || 0) + 1;
      }
    }

    return {
      totalUnique: this.seenTokens.size,
      byPlatform: platformStats,
    };
  }

  private cleanup(): void {
    const cutoffTime = Date.now() - this.maxAge;
    let removed = 0;

    // In a real implementation, we'd track timestamps
    // For now, we'll just clear if the map gets too large
    if (this.seenTokens.size > 10000) {
      const tokensToKeep = Array.from(this.seenTokens.entries())
        .slice(-5000);
      
      this.seenTokens.clear();
      this.tokenHashes.clear();
      
      for (const [address, platforms] of tokensToKeep) {
        this.seenTokens.set(address, platforms);
        this.tokenHashes.set(address, this.generateHash(address));
      }
      
      removed = 5000;
    }

    if (removed > 0) {
      logger.info(`Deduplication cleanup: removed ${removed} old entries`);
    }
  }
}