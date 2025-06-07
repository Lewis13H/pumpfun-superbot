// scripts/populate-token-data.js
// One-time script to populate missing token data

require('dotenv').config();

const { db } = require('../dist/database/postgres');
const { logger } = require('../dist/utils/logger');

// Initialize API clients with error handling
let birdeyeClient, dexScreenerClient, heliusClient, solSnifferClient;

try {
  const { BirdeyeClient } = require('../dist/api/birdeye-client');
  birdeyeClient = new BirdeyeClient();
  logger.info('✅ Birdeye client initialized');
} catch (error) {
  logger.warn('⚠️  Birdeye client initialization failed:', error.message);
}

try {
  const { DexScreenerClient } = require('../dist/api/dexscreener-client');
  dexScreenerClient = new DexScreenerClient();
  logger.info('✅ DexScreener client initialized');
} catch (error) {
  logger.warn('⚠️  DexScreener client initialization failed:', error.message);
}

try {
  const { HeliusClient } = require('../dist/api/helius-client');
  heliusClient = new HeliusClient();
  logger.info('✅ Helius client initialized');
} catch (error) {
  logger.warn('⚠️  Helius client initialization failed:', error.message);
}

try {
  const { SolSnifferClient } = require('../dist/api/solsniffer-client');
  solSnifferClient = new SolSnifferClient();
  logger.info('✅ SolSniffer client initialized');
} catch (error) {
  logger.warn('⚠️  SolSniffer client initialization failed:', error.message);
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTokenData(tokenAddress) {
  const results = {
    symbol: null,
    name: null,
    marketCap: null,
    liquidity: null,
    holders: null,
    topHolderPercentage: null,
    volume24h: null,
    solsnifferScore: null
  };
  
  // Try Birdeye first
  if (birdeyeClient) {
    try {
      logger.info(`Fetching Birdeye data for ${tokenAddress}...`);
      const birdeyeData = await birdeyeClient.getTokenData(tokenAddress);
      if (birdeyeData) {
        results.marketCap = birdeyeData.marketCap;
        results.liquidity = birdeyeData.liquidity;
        results.volume24h = birdeyeData.volume24h;
        results.holders = birdeyeData.holders;
      }
    } catch (error) {
      logger.debug(`Birdeye error: ${error.message}`);
    }
  }
  
  // Try DexScreener for additional data
  if (dexScreenerClient) {
    try {
      logger.info(`Fetching DexScreener data for ${tokenAddress}...`);
      const dexData = await dexScreenerClient.getTokenPairs(tokenAddress);
      if (dexData && dexData.pairs && dexData.pairs.length > 0) {
        const pair = dexData.pairs[0];
        if (!results.marketCap && pair.fdv) {
          results.marketCap = pair.fdv;
        }
        if (!results.liquidity && pair.liquidity?.usd) {
          results.liquidity = pair.liquidity.usd;
        }
        if (!results.volume24h && pair.volume?.h24) {
          results.volume24h = pair.volume.h24;
        }
        
        // Get token info
        const tokenInfo = pair.baseToken.address === tokenAddress ? pair.baseToken : pair.quoteToken;
        if (tokenInfo.symbol && tokenInfo.symbol !== 'UNKNOWN') {
          results.symbol = tokenInfo.symbol;
        }
        if (tokenInfo.name) {
          results.name = tokenInfo.name;
        }
      }
    } catch (error) {
      logger.debug(`DexScreener error: ${error.message}`);
    }
  }
  
  // Get holder data from Helius
  if (heliusClient && (!results.holders || !results.topHolderPercentage)) {
    try {
      logger.info(`Fetching holder data for ${tokenAddress}...`);
      const holderData = await heliusClient.getTokenHolders(tokenAddress);
      if (holderData) {
        results.holders = holderData.totalHolders;
        results.topHolderPercentage = holderData.topHolderPercentage;
      }
    } catch (error) {
      logger.debug(`Helius error: ${error.message}`);
    }
  }
  
  // Only check SolSniffer for tokens with decent market cap
  if (solSnifferClient && results.marketCap && results.marketCap > 10000) {
    try {
      logger.info(`Fetching SolSniffer score for ${tokenAddress}...`);
      const score = await solSnifferClient.getTokenScore(tokenAddress);
      if (score !== null) {
        results.solsnifferScore = score;
      }
    } catch (error) {
      logger.debug(`SolSniffer error: ${error.message}`);
    }
  }
  
  return results;
}

async function populateTokenData() {
  try {
    logger.info('🔍 Finding tokens with missing data...');
    
    // Check which API clients are available
    const availableAPIs = [];
    if (birdeyeClient) availableAPIs.push('Birdeye');
    if (dexScreenerClient) availableAPIs.push('DexScreener');
    if (heliusClient) availableAPIs.push('Helius');
    if (solSnifferClient) availableAPIs.push('SolSniffer');
    
    if (availableAPIs.length === 0) {
      logger.error('❌ No API clients available! Please check your configuration and API keys.');
      return;
    }
    
    logger.info(`📡 Available APIs: ${availableAPIs.join(', ')}`);
    
    // Get tokens that need data
    const tokensNeedingData = await db('tokens')
      .where(function() {
        this.where('symbol', 'UNKNOWN')
          .orWhereNull('market_cap')
          .orWhereNull('holders')
          .orWhereNull('solsniffer_score')
      })
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .orderBy('created_at', 'desc')
      .limit(100);
    
    logger.info(`Found ${tokensNeedingData.length} tokens needing data`);
    
    let updated = 0;
    let failed = 0;
    
    for (const token of tokensNeedingData) {
      try {
        logger.info(`\nProcessing ${token.address} (${updated + failed + 1}/${tokensNeedingData.length})...`);
        
        // Fetch data from various sources
        const data = await fetchTokenData(token.address);
        
        // Build update object
        const updateData = {
          updated_at: new Date(),
          last_scan_at: new Date()
        };
        
        // Only update fields that have data
        if (data.symbol && data.symbol !== 'UNKNOWN') {
          updateData.symbol = data.symbol;
        }
        if (data.name) {
          updateData.name = data.name;
        }
        if (data.marketCap) {
          updateData.market_cap = data.marketCap;
        }
        if (data.liquidity) {
          updateData.liquidity = data.liquidity;
        }
        if (data.holders) {
          updateData.holders = data.holders;
        }
        if (data.topHolderPercentage !== null) {
          updateData.top_10_percent = data.topHolderPercentage;
        }
        if (data.volume24h) {
          updateData.volume_24h = data.volume24h;
        }
        if (data.solsnifferScore !== null) {
          updateData.solsniffer_score = data.solsnifferScore;
          updateData.solsniffer_checked_at = new Date();
        }
        
        // Update the token
        await db('tokens')
          .where('address', token.address)
          .update(updateData);
        
        logger.info(`✅ Updated ${token.address}`);
        logger.info(`   Symbol: ${updateData.symbol || 'N/A'}`);
        logger.info(`   Market Cap: ${updateData.market_cap || 0}`);
        logger.info(`   Holders: ${updateData.holders || 0}`);
        logger.info(`   SolSniffer: ${updateData.solsniffer_score || 'N/A'}`);
        
        updated++;
        
        // Delay to avoid rate limits
        await delay(1500);
        
      } catch (error) {
        logger.error(`❌ Failed to update ${token.address}: ${error.message}`);
        failed++;
        
        // Longer delay on error
        await delay(3000);
      }
    }
    
    logger.info(`\n✅ Population complete!`);
    logger.info(`   Updated: ${updated}`);
    logger.info(`   Failed: ${failed}`);
    
    // Show current status
    const statusQuery = await db('tokens')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw("SUM(CASE WHEN symbol = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_symbols"),
        db.raw('SUM(CASE WHEN market_cap IS NOT NULL THEN 1 ELSE 0 END) as has_market_cap'),
        db.raw('SUM(CASE WHEN holders IS NOT NULL THEN 1 ELSE 0 END) as has_holders'),
        db.raw('SUM(CASE WHEN solsniffer_score IS NOT NULL THEN 1 ELSE 0 END) as has_solsniffer')
      )
      .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .first();
    
    logger.info(`\n📊 Current Status (last 24h):`);
    logger.info(`   Total tokens: ${statusQuery.total}`);
    logger.info(`   Unknown symbols: ${statusQuery.unknown_symbols}`);
    logger.info(`   Has market cap: ${statusQuery.has_market_cap}`);
    logger.info(`   Has holders: ${statusQuery.has_holders}`);
    logger.info(`   Has SolSniffer: ${statusQuery.has_solsniffer}`);
    
  } catch (error) {
    logger.error('Fatal error:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  populateTokenData();
}