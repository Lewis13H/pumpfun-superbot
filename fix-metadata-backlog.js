// fix-metadata-backlog.js - Aggressively fix metadata backlog

const { HELIUS_METADATA_SERVICE } = require('./src/services/helius-metadata-service');
const { db } = require('./src/database/postgres-js');

async function fixMetadataBacklog() {
  console.log('🚀 Starting aggressive metadata backlog fix...');
  console.log(''.padEnd(60, '-'));
  
  try {
    // Check total tokens needing metadata
    const countResult = await db('tokens')
      .where(function() {
        this.where('symbol', 'like', 'PUMP%')
          .orWhere('symbol', 'LOADING...')
          .orWhere('symbol', 'UNKNOWN')
          .orWhereNull('symbol');
      })
      .count('* as total');
    
    const totalNeedingFix = parseInt(countResult[0].total);
    console.log(`📊 Total tokens needing metadata: ${totalNeedingFix}`);
    
    if (totalNeedingFix === 0) {
      console.log('✅ No tokens need metadata fixing!');
      return;
    }
    
    // Process in batches
    const BATCH_SIZE = 100;
    const DELAY_BETWEEN_BATCHES = 30000; // 30 seconds
    
    let processed = 0;
    let successful = 0;
    
    console.log(`🔄 Processing in batches of ${BATCH_SIZE}...`);
    console.log(`⏱️ ${DELAY_BETWEEN_BATCHES/1000}s delay between batches for rate limiting`);
    
    while (processed < totalNeedingFix) {
      console.log(`\n📦 Batch ${Math.floor(processed/BATCH_SIZE) + 1}: Processing tokens ${processed + 1}-${Math.min(processed + BATCH_SIZE, totalNeedingFix)}`);
      
      // Fix this batch
      const batchFixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(BATCH_SIZE);
      
      processed += BATCH_SIZE;
      successful += batchFixed;
      
      console.log(`✅ Batch complete: ${batchFixed} tokens fixed`);
      console.log(`📈 Progress: ${successful}/${totalNeedingFix} total (${((successful/totalNeedingFix)*100).toFixed(1)}%)`);
      
      // Rate limiting between batches
      if (processed < totalNeedingFix) {
        console.log(`⏱️ Waiting ${DELAY_BETWEEN_BATCHES/1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    console.log(`\n🎉 Backlog processing complete!`);
    console.log(`📊 Final results:`);
    console.log(`   Total processed: ${totalNeedingFix}`);
    console.log(`   Successfully fixed: ${successful}`);
    console.log(`   Success rate: ${((successful/totalNeedingFix)*100).toFixed(1)}%`);
    
    // Check final state
    const remainingResult = await db('tokens')
      .where(function() {
        this.where('symbol', 'like', 'PUMP%')
          .orWhere('symbol', 'LOADING...')
          .orWhere('symbol', 'UNKNOWN')
          .orWhereNull('symbol');
      })
      .count('* as total');
    
    const remaining = parseInt(remainingResult[0].total);
    console.log(`📋 Tokens still needing metadata: ${remaining}`);
    
    if (remaining > 0) {
      console.log(`💡 These might be tokens that Helius doesn't have metadata for`);
      console.log(`💡 Run this script again later or check individual tokens manually`);
    }
    
  } catch (error) {
    console.log(`❌ Backlog fix failed:`, error.message);
  } finally {
    await db.destroy();
  }
}

// Run with progress monitoring
async function runWithMonitoring() {
  // Start monitoring
  const monitorInterval = setInterval(async () => {
    try {
      const stats = HELIUS_METADATA_SERVICE.getStats();
      console.log(`📊 Queue status: ${stats.processingQueue} processing, ${stats.retryQueue} retrying`);
    } catch (error) {
      // Silent fail
    }
  }, 10000); // Every 10 seconds
  
  try {
    await fixMetadataBacklog();
  } finally {
    clearInterval(monitorInterval);
  }
}

if (require.main === module) {
  runWithMonitoring().catch(console.error);
}