// src/services/helius-metadata-service.js - JavaScript version for immediate use

const axios = require('axios');
const { db } = require('../database/postgres-js');

// Simple logger if logger2 doesn't exist
let logger;
try {
  logger = require('../utils/logger2').logger;
} catch (error) {
  logger = {
    info: console.log,
    debug: console.log,
    warn: console.warn,
    error: console.error
  };
}

class HeliusMetadataService {
  constructor(rpcUrl) {
    this.rpcUrl = rpcUrl.trim().replace(/['"]/g, '');
    this.retryDelay = 1000;
    this.maxRetries = 3;
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.requestDelay = 200; // 200ms between requests
    
    // Processing queue
    this.processingQueue = new Set();
    this.retryQueue = new Map();
    
    logger.info('✅ Helius Metadata Service initialized:', {
      endpoint: this.rpcUrl.substring(0, 50) + '...'
    });
    
    // Start batch processing service
    this.startBatchProcessor();
    
    // Process retry queue every 30 seconds
    setInterval(() => this.processRetryQueue(), 30000);
  }
  
  /**
   * Fetch metadata for a single token immediately
   */
  async fetchTokenMetadata(tokenAddress) {
    try {
      await this.rateLimit();
      
      logger.debug(`🔍 Fetching metadata for ${tokenAddress.substring(0, 8)}...`);
      
      // Method 1: Try Enhanced getAsset (DAS API)
      try {
        const dasResult = await this.fetchWithDAS(tokenAddress);
        if (dasResult && this.isValidMetadata(dasResult)) {
          logger.info(`✅ DAS metadata fetched: ${tokenAddress.substring(0, 8)}... → ${dasResult.symbol} (${dasResult.name})`);
          await this.updateTokenInDatabase(tokenAddress, dasResult);
          return dasResult;
        }
      } catch (error) {
        logger.debug(`DAS method failed for ${tokenAddress.substring(0, 8)}..., trying RPC`);
      }
      
      // Method 2: Try Enhanced RPC getAccountInfo
      try {
        const rpcResult = await this.fetchWithEnhancedRPC(tokenAddress);
        if (rpcResult && this.isValidMetadata(rpcResult)) {
          logger.info(`✅ Enhanced RPC metadata fetched: ${tokenAddress.substring(0, 8)}... → ${rpcResult.symbol} (${rpcResult.name})`);
          await this.updateTokenInDatabase(tokenAddress, rpcResult);
          return rpcResult;
        }
      } catch (error) {
        logger.debug(`Enhanced RPC failed for ${tokenAddress.substring(0, 8)}..., trying basic RPC`);
      }
      
      // Method 3: Basic RPC as last resort
      try {
        const basicResult = await this.fetchWithBasicRPC(tokenAddress);
        if (basicResult && this.isValidMetadata(basicResult)) {
          logger.info(`✅ Basic RPC metadata fetched: ${tokenAddress.substring(0, 8)}... → ${basicResult.symbol} (${basicResult.name})`);
          await this.updateTokenInDatabase(tokenAddress, basicResult);
          return basicResult;
        }
      } catch (error) {
        logger.debug(`All methods failed for ${tokenAddress.substring(0, 8)}...`);
      }
      
      logger.debug(`❌ No valid metadata found for ${tokenAddress.substring(0, 8)}...`);
      return null;
      
    } catch (error) {
      logger.error(`❌ Metadata fetch failed for ${tokenAddress.substring(0, 8)}...: ${error.message}`);
      
      if (error.response?.status === 429) {
        this.addToRetryQueue(tokenAddress);
      }
      
      return null;
    }
  }
  
  /**
   * Method 1: DAS (Digital Asset Standard) API
   */
  async fetchWithDAS(tokenAddress) {
    const response = await axios.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: 'helius-metadata',
      method: 'getAsset',
      params: {
        id: tokenAddress,
        displayOptions: {
          showFungible: true,
          showNativeBalance: true
        }
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data?.result) {
      const asset = response.data.result;
      
      // Parse DAS response
      if (asset.content?.metadata || asset.token_info) {
        const metadata = asset.content?.metadata;
        const tokenInfo = asset.token_info;
        
        return {
          address: tokenAddress,
          symbol: metadata?.symbol || tokenInfo?.symbol || 'UNKNOWN',
          name: metadata?.name || tokenInfo?.name || 'Unknown Token',
          decimals: tokenInfo?.decimals || asset.token_info?.decimals || 6,
          supply: tokenInfo?.supply?.toString() || '0',
          metadata: {
            symbol: metadata?.symbol || tokenInfo?.symbol || 'UNKNOWN',
            name: metadata?.name || tokenInfo?.name || 'Unknown Token',
            description: metadata?.description || '',
            image: metadata?.image || asset.content?.files?.[0]?.uri || '',
            external_url: metadata?.external_url || ''
          }
        };
      }
    }
    
    return null;
  }
  
  /**
   * Method 2: Enhanced RPC with token metadata
   */
  async fetchWithEnhancedRPC(tokenAddress) {
    const response = await axios.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: 'helius-enhanced',
      method: 'getAccountInfo',
      params: [
        tokenAddress,
        {
          encoding: 'jsonParsed',
          commitment: 'confirmed'
        }
      ]
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data?.result?.value) {
      const account = response.data.result.value;
      
      if (account.data?.parsed?.type === 'mint') {
        const parsed = account.data.parsed.info;
        
        // Try to get metadata from Metaplex
        const metadataResult = await this.fetchMetaplexMetadata(tokenAddress);
        
        return {
          address: tokenAddress,
          symbol: metadataResult?.symbol || 'UNKNOWN',
          name: metadataResult?.name || 'Unknown Token',
          decimals: parsed.decimals || 6,
          supply: parsed.supply || '0',
          metadata: {
            symbol: metadataResult?.symbol || 'UNKNOWN',
            name: metadataResult?.name || 'Unknown Token',
            description: metadataResult?.description || '',
            image: metadataResult?.image || '',
            external_url: metadataResult?.external_url || ''
          }
        };
      }
    }
    
    return null;
  }
  
  /**
   * Method 3: Basic RPC (minimal data)
   */
  async fetchWithBasicRPC(tokenAddress) {
    const response = await axios.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: 'helius-basic',
      method: 'getAccountInfo',
      params: [
        tokenAddress,
        { encoding: 'base64' }
      ]
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data?.result?.value) {
      // Return minimal info (will show as Unknown but at least won't be null)
      return {
        address: tokenAddress,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 6,
        supply: '0',
        metadata: {
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          description: '',
          image: '',
          external_url: ''
        }
      };
    }
    
    return null;
  }
  
  /**
   * Try to fetch Metaplex metadata
   */
  async fetchMetaplexMetadata(tokenAddress) {
    try {
      // Get metadata account address
      const response = await axios.post(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 'metaplex-metadata',
        method: 'getTokenMetadata',
        params: {
          mint: tokenAddress
        }
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      return response.data?.result || null;
      
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Queue token for metadata processing (non-blocking)
   */
  queueTokenForMetadata(tokenAddress) {
    if (this.processingQueue.has(tokenAddress)) {
      return; // Already queued
    }
    
    this.processingQueue.add(tokenAddress);
    logger.debug(`📝 Queued metadata fetch: ${tokenAddress.substring(0, 8)}...`);
  }
  
  /**
   * Fix existing tokens with missing metadata
   */
  async fixMissingMetadata(limit = 50) {
    try {
      // Find tokens with missing or placeholder metadata
      const tokens = await db('tokens')
        .where(function() {
          this.where('symbol', 'like', 'PUMP%')
            .orWhere('symbol', 'UNKNOWN')
            .orWhere('symbol', 'LOADING...')
            .orWhere('name', 'Unknown Token')
            .orWhere('name', 'Loading...')
            .orWhereNull('symbol')
            .orWhereNull('name');
        })
        .where('created_at', '>', new Date(Date.now() - 48 * 60 * 60 * 1000)) // Last 48 hours
        .orderBy('market_cap', 'desc')
        .limit(limit)
        .select('address', 'symbol', 'name');
      
      if (tokens.length === 0) {
        return 0;
      }
      
      logger.info(`🔧 Fixing metadata for ${tokens.length} tokens with Helius...`);
      
      let fixed = 0;
      for (const token of tokens) {
        const metadata = await this.fetchTokenMetadata(token.address);
        if (metadata) {
          fixed++;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }
      
      logger.info(`✅ Fixed metadata for ${fixed}/${tokens.length} tokens using Helius`);
      return fixed;
      
    } catch (error) {
      logger.error('Error fixing missing metadata:', error?.message);
      return 0;
    }
  }
  
  /**
   * Start background batch processor
   */
  startBatchProcessor() {
    setInterval(async () => {
      if (this.processingQueue.size === 0) return;
      
      // Process up to 3 tokens per batch (conservative)
      const tokensToProcess = Array.from(this.processingQueue).slice(0, 3);
      
      for (const tokenAddress of tokensToProcess) {
        this.processingQueue.delete(tokenAddress);
        
        try {
          await this.fetchTokenMetadata(tokenAddress);
        } catch (error) {
          // Add to retry queue if failed
          this.addToRetryQueue(tokenAddress);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }
    }, 15000); // Process every 15 seconds (conservative)
  }
  
  /**
   * Process retry queue
   */
  async processRetryQueue() {
    if (this.retryQueue.size === 0) return;
    
    logger.info(`🔄 Processing ${this.retryQueue.size} tokens in retry queue...`);
    
    const retries = Array.from(this.retryQueue.entries()).slice(0, 3); // Limit retries
    
    for (const [tokenAddress, retryCount] of retries) {
      if (retryCount >= this.maxRetries) {
        this.retryQueue.delete(tokenAddress);
        logger.warn(`❌ Max retries reached for ${tokenAddress.substring(0, 8)}...`);
        continue;
      }
      
      try {
        const metadata = await this.fetchTokenMetadata(tokenAddress);
        if (metadata) {
          this.retryQueue.delete(tokenAddress);
          logger.info(`✅ Retry successful for ${tokenAddress.substring(0, 8)}...`);
        } else {
          this.retryQueue.set(tokenAddress, retryCount + 1);
        }
      } catch (error) {
        this.retryQueue.set(tokenAddress, retryCount + 1);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, this.requestDelay));
    }
  }
  
  /**
   * Add token to retry queue
   */
  addToRetryQueue(tokenAddress) {
    const currentRetries = this.retryQueue.get(tokenAddress) || 0;
    if (currentRetries < this.maxRetries) {
      this.retryQueue.set(tokenAddress, currentRetries + 1);
    }
  }
  
  /**
   * Rate limiting
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Validate metadata quality
   */
  isValidMetadata(tokenInfo) {
    if (!tokenInfo) return false;
    
    // Accept any non-empty symbol and name for now
    if (!tokenInfo.symbol || tokenInfo.symbol.length === 0) {
      return false;
    }
    
    if (!tokenInfo.name || tokenInfo.name.length === 0) {
      return false;
    }
    
    // Don't reject UNKNOWN - Helius might not have metadata for new tokens
    return true;
  }
  
  /**
   * Update token in database
   */
  async updateTokenInDatabase(tokenAddress, tokenInfo) {
    try {
      logger.info(`🔧 ATTEMPTING DB UPDATE: ${tokenAddress.substring(0, 8)}... → ${tokenInfo.symbol} (${tokenInfo.name})`);
      
      const updateData = {
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        updated_at: new Date()
      };
      
      // Add optional fields if they exist
      if (tokenInfo.metadata?.description) {
        updateData.description = tokenInfo.metadata.description;
      }
      
      if (tokenInfo.metadata?.image) {
        updateData.image_url = tokenInfo.metadata.image;
      }
      
      if (tokenInfo.metadata?.external_url) {
        updateData.external_url = tokenInfo.metadata.external_url;
      }
      
      const result = await db('tokens')
        .where('address', tokenAddress)
        .update(updateData);
      
      logger.info(`🔧 DB UPDATE RESULT: ${result} rows affected for ${tokenAddress.substring(0, 8)}...`);
      
      if (result > 0) {
        logger.info(`✅ DB UPDATE SUCCESS: ${tokenAddress.substring(0, 8)}... → ${tokenInfo.symbol} (${tokenInfo.name})`);
      } else {
        logger.warn(`⚠️ DB UPDATE NO ROWS: ${tokenAddress.substring(0, 8)}... not found in database`);
      }
    } catch (error) {
      logger.error(`❌ DB UPDATE ERROR for ${tokenAddress.substring(0, 8)}...:`, error?.message);
    }
  }
  
  /**
   * Get processing stats
   */
  getStats() {
    return {
      processingQueue: this.processingQueue.size,
      retryQueue: this.retryQueue.size,
      maxRetries: this.maxRetries,
      requestDelay: this.requestDelay
    };
  }
}

// Export singleton with Helius RPC URL
const HELIUS_METADATA_SERVICE = new HeliusMetadataService(
  process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=d2fa57b6-40cc-45e4-80f8-285377ec5dea'
);

module.exports = { 
  HeliusMetadataService,
  HELIUS_METADATA_SERVICE 
};