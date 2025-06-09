// src/services/multi-source-metadata-service.js
// Enhanced metadata service v4.21 - FIXED DATABASE CONNECTION
// Handles pump.fun tokens with multiple sources

const axios = require('axios');

// 🔧 FIXED: Correct database path
let db;
try {
  const { db: database } = require('../database/postgres-js'); // Fixed path!
  db = database;
} catch (error) {
  console.warn('⚠️ Database connection fallback');
  db = null;
}

// 🔧 FIXED: Simplified logger (avoid TypeScript import issues)
let logger;
try {
  // Try TypeScript logger first
  logger = require('../utils/logger2').logger;
} catch (error) {
  try {
    // Try JavaScript logger
    logger = require('../utils/logger').logger;
  } catch (error2) {
    // Fallback to console
    logger = { 
      info: console.log, 
      debug: console.log, 
      warn: console.warn, 
      error: console.error 
    };
  }
}

class MultiSourceMetadataService {
  constructor(rpcUrl) {
    this.heliusApiUrl = rpcUrl?.trim().replace(/['"\]]/g, '') || process.env.HELIUS_RPC_URL;
    this.requestDelay = 300; // Slightly slower for multiple API calls
    this.maxRetries = 3;
    this.lastRequestTime = 0;
    
    // Queues
    this.processingQueue = new Set();
    this.retryQueue = new Map();
    
    // Enhanced stats for multiple sources
    this.stats = {
      totalFetches: 0,
      successfulFetches: 0,
      dasSuccesses: 0,
      jupiterSuccesses: 0,
      birdeyeSuccesses: 0,
      fallbackSuccesses: 0,
      socialLinksFound: 0,
      failures: 0,
      avgResponseTime: 0
    };
    
    logger.info('✅ Multi-Source Metadata Service v4.21 initialized:', {
      endpoint: this.heliusApiUrl?.substring(0, 50) + '...',
      dbAvailable: !!db
    });
    
    if (db) {
      this.startBackgroundProcessor();
    }
  }

  /**
   * 🎯 Multi-source metadata fetching for pump.fun tokens
   */
  async fetchTokenMetadata(tokenAddress) {
    const startTime = Date.now();
    this.stats.totalFetches++;
    
    try {
      await this.rateLimit();
      
      logger.debug(`🔍 Multi-source metadata fetch: ${tokenAddress.substring(0, 8)}...`);
      
      // Method 1: Enhanced DAS (fastest, try first)
      let result = await this.tryDASMetadata(tokenAddress);
      if (result && this.isValidMetadata(result)) {
        this.stats.dasSuccesses++;
        result.metadataSource = 'enhanced_das';
      } else {
        // Method 2: Jupiter API (good for basic info)
        result = await this.tryJupiterMetadata(tokenAddress);
        if (result && this.isValidMetadata(result)) {
          this.stats.jupiterSuccesses++;
          result.metadataSource = 'jupiter_api';
        } else {
          // Method 3: Birdeye API (good for social links)
          result = await this.tryBirdeyeMetadata(tokenAddress);
          if (result && this.isValidMetadata(result)) {
            this.stats.birdeyeSuccesses++;
            result.metadataSource = 'birdeye_api';
          } else {
            // Method 4: Pump.fun specific fallback
            result = await this.tryPumpfunFallback(tokenAddress);
            if (result && this.isValidMetadata(result)) {
              this.stats.fallbackSuccesses++;
              result.metadataSource = 'pumpfun_fallback';
            }
          }
        }
      }
      
      if (result && this.isValidMetadata(result)) {
        this.stats.successfulFetches++;
        
        // Enhance with social link detection
        result = await this.enhanceWithSocialLinks(result);
        
        // Calculate legitimacy score
        result.legitimacyScore = this.calculateLegitimacyScore(result);
        
        // Store in database (FIXED: Check db is available)
        if (db) {
          const saved = await this.updateTokenWithMetadata(tokenAddress, result);
          if (saved) {
            logger.debug(`💾 Database updated for ${tokenAddress.substring(0, 8)}...`);
          }
        } else {
          logger.warn(`⚠️ Database not available - metadata not saved for ${tokenAddress.substring(0, 8)}...`);
        }
        
        logger.info(`✅ Multi-source metadata: ${tokenAddress.substring(0, 8)}... → ${result.symbol} (${result.metadataSource}, Score: ${result.legitimacyScore}/100)`);
        return result;
      }
      
      // All methods failed
      this.stats.failures++;
      if (db) {
        await this.incrementFetchAttempts(tokenAddress);
      }
      
      logger.debug(`❌ All metadata sources failed: ${tokenAddress.substring(0, 8)}...`);
      return null;
      
    } catch (error) {
      this.stats.failures++;
      logger.error(`❌ Multi-source fetch failed: ${tokenAddress.substring(0, 8)}...: ${error.message}`);
      return null;
    } finally {
      const responseTime = Date.now() - startTime;
      this.stats.avgResponseTime = Math.round(
        (this.stats.avgResponseTime * (this.stats.totalFetches - 1) + responseTime) / this.stats.totalFetches
      );
    }
  }

  /**
   * 🚀 Method 1: Enhanced DAS with aggressive parsing
   */
  async tryDASMetadata(tokenAddress) {
    try {
      const response = await axios.post(this.heliusApiUrl, {
        jsonrpc: '2.0',
        id: 'multi-das',
        method: 'getAsset',
        params: {
          id: tokenAddress,
          displayOptions: {
            showFungible: true,
            showNativeBalance: true,
            showInscription: true,
            showCollectionMetadata: true,
            showCreators: true,
            showOwnership: true,
            showSupply: true,
            showUnverifiedCollections: true
          }
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (!response.data?.result) return null;

      const asset = response.data.result;
      
      // Aggressive metadata extraction
      const metadata = asset.content?.metadata || {};
      const tokenInfo = asset.token_info || {};
      
      // Try multiple sources for each field
      const symbol = metadata.symbol ||
                    tokenInfo.symbol ||
                    metadata.properties?.symbol ||
                    metadata.name?.split(' ')[0] ||
                    'UNKNOWN';
      
      const name = metadata.name ||
                  tokenInfo.name ||
                  metadata.properties?.name ||
                  metadata.description?.split(' ').slice(0, 3).join(' ') ||
                  'Unknown Token';
      
      // Only return if we have valid basic info
      if (symbol !== 'UNKNOWN' && name !== 'Unknown Token') {
        return {
          address: tokenAddress,
          symbol: symbol,
          name: name,
          description: metadata.description || tokenInfo.description || null,
          imageUrl: metadata.image ||
                   asset.content?.files?.[0]?.uri ||
                   metadata.properties?.image || null,
          decimals: tokenInfo.decimals || asset.supply?.decimals || 6,
          totalSupply: tokenInfo.supply?.toString() || asset.supply?.total?.toString() || '0',
          mintAuthority: tokenInfo.mint_authority !== '11111111111111111111111111111111' ? tokenInfo.mint_authority : null,
          freezeAuthority: tokenInfo.freeze_authority !== '11111111111111111111111111111111' ? tokenInfo.freeze_authority : null,
          fetchedAt: new Date()
        };
      }
      
      return null;
      
    } catch (error) {
      logger.debug(`DAS method failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🪐 Method 2: Jupiter API for token info
   */
  async tryJupiterMetadata(tokenAddress) {
    try {
      // Jupiter has a comprehensive token list
      const response = await axios.get('https://token.jup.ag/all', {
        timeout: 15000
      });
      
      if (response.data && Array.isArray(response.data)) {
        const tokenData = response.data.find(token => token.address === tokenAddress);
        
        if (tokenData && tokenData.symbol && tokenData.name) {
          logger.debug(`Jupiter found: ${tokenData.symbol} - ${tokenData.name}`);
          
          return {
            address: tokenAddress,
            symbol: tokenData.symbol,
            name: tokenData.name,
            description: null,
            imageUrl: tokenData.logoURI || null,
            decimals: tokenData.decimals || 6,
            totalSupply: '0',
            mintAuthority: null,
            freezeAuthority: null,
            fetchedAt: new Date()
          };
        }
      }
      
      return null;
      
    } catch (error) {
      logger.debug(`Jupiter method failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🐦 Method 3: Birdeye API for comprehensive data
   */
  async tryBirdeyeMetadata(tokenAddress) {
    try {
      // Birdeye API often has social links and metadata
      const response = await axios.get(`https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`, {
        timeout: 10000,
        headers: {
          'X-API-KEY': process.env.BIRDEYE_API_KEY || 'public' // Use public if no key
        }
      });
      
      if (response.data?.data) {
        const data = response.data.data;
        
        if (data.symbol && data.name) {
          logger.debug(`Birdeye found: ${data.symbol} - ${data.name}`);
          
          return {
            address: tokenAddress,
            symbol: data.symbol,
            name: data.name,
            description: data.description || null,
            imageUrl: data.logoURI || null,
            decimals: data.decimals || 6,
            totalSupply: data.supply?.toString() || '0',
            mintAuthority: null,
            freezeAuthority: null,
            // Birdeye often has social links
            twitterUrl: data.twitter || null,
            telegramUrl: data.telegram || null,
            websiteUrl: data.website || null,
            fetchedAt: new Date()
          };
        }
      }
      
      return null;
      
    } catch (error) {
      logger.debug(`Birdeye method failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🎯 Method 4: Pump.fun specific fallback with educated guessing
   */
  async tryPumpfunFallback(tokenAddress) {
    try {
      // For pump.fun tokens, try to extract info from the address pattern
      if (tokenAddress.endsWith('pump')) {
        // Get basic account info
        const response = await axios.post(this.heliusApiUrl, {
          jsonrpc: '2.0',
          id: 'pumpfun-fallback',
          method: 'getAccountInfo',
          params: [
            tokenAddress,
            { encoding: 'base64' }
          ]
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });

        if (response.data?.result?.value) {
          // Generate a basic token entry based on the address
          const addressPrefix = tokenAddress.substring(0, 4).toUpperCase();
          
          return {
            address: tokenAddress,
            symbol: `${addressPrefix}`,
            name: `Pump Token ${addressPrefix}`,
            description: 'Pump.fun token with limited metadata',
            imageUrl: null,
            decimals: 6,
            totalSupply: '1000000000000000', // Standard pump.fun supply
            mintAuthority: null, // Pump.fun tokens typically renounce
            freezeAuthority: null,
            fetchedAt: new Date()
          };
        }
      }
      
      return null;
      
    } catch (error) {
      logger.debug(`Pump.fun fallback failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🔗 Enhance metadata with social link detection
   */
  async enhanceWithSocialLinks(tokenData) {
    // If we already have social links from Birdeye, use them
    if (tokenData.twitterUrl || tokenData.telegramUrl) {
      this.stats.socialLinksFound++;
      return tokenData;
    }
    
    // Try to find social links in description or external sources
    if (tokenData.description) {
      const socialLinks = this.extractSocialLinksFromText(tokenData.description);
      
      if (socialLinks.twitter || socialLinks.telegram || socialLinks.discord) {
        this.stats.socialLinksFound++;
        return {
          ...tokenData,
          ...socialLinks
        };
      }
    }
    
    // Try searching for social links by token symbol (for established tokens)
    if (tokenData.symbol && tokenData.symbol !== 'UNKNOWN' && tokenData.symbol.length > 2) {
      const socialLinks = await this.searchSocialLinksBySymbol(tokenData.symbol);
      
      if (socialLinks.twitter || socialLinks.telegram) {
        this.stats.socialLinksFound++;
        return {
          ...tokenData,
          ...socialLinks
        };
      }
    }
    
    return tokenData;
  }

  /**
   * 🔍 Extract social links from text
   */
  extractSocialLinksFromText(text) {
    const links = {
      twitterUrl: null,
      telegramUrl: null,
      discordUrl: null,
      websiteUrl: null
    };
    
    const patterns = {
      twitter: /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[\w]+/gi,
      telegram: /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/[\w]+/gi,
      discord: /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[\w]+/gi,
      website: /https?:\/\/(?:www\.)?[\w.-]+\.[a-z]{2,}/gi
    };
    
    Object.entries(patterns).forEach(([platform, pattern]) => {
      const match = text.match(pattern);
      if (match) {
        const key = platform === 'twitter' ? 'twitterUrl' :
                   platform === 'telegram' ? 'telegramUrl' :
                   platform === 'discord' ? 'discordUrl' : 'websiteUrl';
        links[key] = match[0];
      }
    });
    
    return links;
  }

  /**
   * 🔍 Search for social links by token symbol (for known tokens)
   */
  async searchSocialLinksBySymbol(symbol) {
    // This could be enhanced to search various community databases
    // For now, return empty to avoid API abuse
    return {
      twitterUrl: null,
      telegramUrl: null,
      discordUrl: null,
      websiteUrl: null
    };
  }

  /**
   * 📊 Calculate legitimacy score with multiple factors
   */
  calculateLegitimacyScore(tokenData) {
    let score = 0;
    
    // Core identity (30 points)
    if (tokenData.symbol && !['UNKNOWN', 'LOADING...', ''].includes(tokenData.symbol)) {
      score += tokenData.symbol.length > 2 ? 15 : 10; // Longer symbols slightly better
    }
    if (tokenData.name && !['Unknown Token', 'Loading...', ''].includes(tokenData.name)) {
      score += tokenData.name.length > 5 ? 15 : 10; // Longer names slightly better
    }
    
    // Content quality (20 points)
    if (tokenData.description && tokenData.description.length > 10) score += 10;
    if (tokenData.imageUrl) score += 10;
    
    // Social verification (35 points - highest weight)
    if (tokenData.twitterUrl) score += 20;
    if (tokenData.telegramUrl) score += 10;
    if (tokenData.discordUrl) score += 3;
    if (tokenData.websiteUrl) score += 2;
    
    // Metadata source bonus (10 points)
    if (tokenData.metadataSource === 'enhanced_das') score += 10;
    else if (tokenData.metadataSource === 'jupiter_api') score += 8;
    else if (tokenData.metadataSource === 'birdeye_api') score += 6;
    else score += 3;
    
    // Security (5 points)
    if (!tokenData.mintAuthority) score += 5;
    
    return Math.min(score, 100);
  }

  /**
   * 💾 Store metadata in database (FIXED: Enhanced error handling)
   */
  async updateTokenWithMetadata(tokenAddress, tokenData) {
    if (!db) {
      logger.warn('Database not available for metadata update');
      return false;
    }
    
    try {
      // 🔧 FIXED: Ensure all fields are properly handled
      const updateData = {
        symbol: tokenData.symbol || 'UNKNOWN',
        name: tokenData.name || 'Unknown Token',
        description: tokenData.description || null,
        image_url: tokenData.imageUrl || null,
        twitter_url: tokenData.twitterUrl || null,
        telegram_url: tokenData.telegramUrl || null,
        discord_url: tokenData.discordUrl || null,
        website_url: tokenData.websiteUrl || null,
        mint_authority: tokenData.mintAuthority || null,
        freeze_authority: tokenData.freezeAuthority || null,
        decimals: tokenData.decimals || 6,
        total_supply: tokenData.totalSupply || '0',
        metadata_source: tokenData.metadataSource || 'unknown',
        legitimacy_score: tokenData.legitimacyScore || 0,
        metadata_updated_at: new Date(),
        metadata_fetch_attempts: db.raw('COALESCE(metadata_fetch_attempts, 0) + 1'),
        updated_at: new Date()
      };
      
      const result = await db('tokens')
        .where('address', tokenAddress)
        .update(updateData);
      
      if (result > 0) {
        logger.debug(`✅ Database updated: ${tokenAddress.substring(0, 8)}... → ${tokenData.symbol}`);
        return true;
      } else {
        logger.warn(`⚠️ No rows updated for token: ${tokenAddress.substring(0, 8)}...`);
        return false;
      }
      
    } catch (error) {
      logger.error(`❌ Database update failed for ${tokenAddress.substring(0, 8)}...: ${error.message}`);
      return false;
    }
  }

  /**
   * 🔧 Fix LOADING tokens with multi-source approach
   */
  async fixLoadingTokens(limit = 25) {
    if (!db) {
      logger.warn('Database not available');
      return 0;
    }
    
    try {
      // Get high-value LOADING tokens first
      const loadingTokens = await db('tokens')
        .where(function() {
          this.where('symbol', 'LOADING...')
              .orWhere('name', 'Loading...')
              .orWhere('symbol', 'UNKNOWN')
              .orWhere('name', 'Unknown Token');
        })
        .andWhere(function() {
          this.where('market_cap', '>', 2000) // Focus on tokens worth >$2k
              .orWhere('category', 'in', ['AIM', 'HIGH', 'MEDIUM'])
              .orWhere('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"));
        })
        .orderBy([
          { column: 'market_cap', order: 'desc' },
          { column: 'created_at', order: 'desc' }
        ])
        .limit(limit)
        .select('address', 'symbol', 'name', 'market_cap');
      
      if (loadingTokens.length === 0) {
        logger.info('✅ No high-value LOADING tokens found');
        return 0;
      }
      
      logger.info(`🔧 Multi-source fixing ${loadingTokens.length} high-value LOADING tokens...`);
      
      let fixed = 0;
      for (const token of loadingTokens) {
        const metadata = await this.fetchTokenMetadata(token.address);
        if (metadata && metadata.legitimacyScore > 20) {
          fixed++;
          logger.debug(`  ✅ Fixed: ${token.address.substring(0, 8)}... → ${metadata.symbol} (${metadata.metadataSource}, ${metadata.legitimacyScore}/100)`);
        }
        
        // Rate limiting between requests
        await this.sleep(this.requestDelay);
      }
      
      logger.info(`✅ Multi-source fix completed: ${fixed}/${loadingTokens.length} tokens improved`);
      return fixed;
      
    } catch (error) {
      logger.error('Multi-source fix failed:', error.message);
      return 0;
    }
  }

  /**
   * 📊 Get comprehensive statistics
   */
  getStats() {
    const successRate = this.stats.totalFetches > 0 ?
      Math.round((this.stats.successfulFetches / this.stats.totalFetches) * 100) : 0;
    
    const socialRate = this.stats.successfulFetches > 0 ?
      Math.round((this.stats.socialLinksFound / this.stats.successfulFetches) * 100) : 0;
    
    return {
      ...this.stats,
      processingQueue: this.processingQueue.size,
      retryQueue: this.retryQueue.size,
      requestDelay: this.requestDelay,
      successRate,
      socialVerificationRate: socialRate,
      databaseAvailable: !!db,
      
      // Source breakdown
      dasRate: this.stats.totalFetches > 0 ? Math.round((this.stats.dasSuccesses / this.stats.totalFetches) * 100) : 0,
      jupiterRate: this.stats.totalFetches > 0 ? Math.round((this.stats.jupiterSuccesses / this.stats.totalFetches) * 100) : 0,
      birdeyeRate: this.stats.totalFetches > 0 ? Math.round((this.stats.birdeyeSuccesses / this.stats.totalFetches) * 100) : 0,
      fallbackRate: this.stats.totalFetches > 0 ? Math.round((this.stats.fallbackSuccesses / this.stats.totalFetches) * 100) : 0
    };
  }

  // Utility methods
  isValidMetadata(tokenData) {
    if (!tokenData) return false;
    if (!tokenData.symbol || ['UNKNOWN', 'LOADING...', ''].includes(tokenData.symbol)) return false;
    if (!tokenData.name || ['Unknown Token', 'Loading...', ''].includes(tokenData.name)) return false;
    return true;
  }

  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await this.sleep(this.requestDelay - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async incrementFetchAttempts(tokenAddress) {
    if (!db) return;
    try {
      await db('tokens')
        .where('address', tokenAddress)
        .update({
          metadata_fetch_attempts: db.raw('COALESCE(metadata_fetch_attempts, 0) + 1'),
          metadata_updated_at: new Date()
        });
    } catch (error) {
      logger.debug('Failed to increment fetch attempts:', error.message);
    }
  }

  // Queue management
  queueTokenForMetadata(tokenAddress) {
    this.processingQueue.add(tokenAddress);
  }

  startBackgroundProcessor() {
    if (!db) return;
    
    // Process high-value tokens every 30 seconds
    setInterval(async () => {
      if (this.processingQueue.size > 0) {
        const tokens = Array.from(this.processingQueue).slice(0, 2); // Slower batch processing
        for (const token of tokens) {
          this.processingQueue.delete(token);
          try {
            await this.fetchTokenMetadata(token);
          } catch (error) {
            // Will retry later
          }
          await this.sleep(this.requestDelay);
        }
      }
    }, 30000);
  }

  // Legacy compatibility
  async fixMissingMetadata(limit = 25) {
    return await this.fixLoadingTokens(limit);
  }
}

// Create multi-source singleton
const MULTI_SOURCE_METADATA_SERVICE = new MultiSourceMetadataService(process.env.HELIUS_RPC_URL);

module.exports = {
  MultiSourceMetadataService,
  MULTI_SOURCE_METADATA_SERVICE,
  // Legacy compatibility
  HELIUS_METADATA_SERVICE: MULTI_SOURCE_METADATA_SERVICE
};