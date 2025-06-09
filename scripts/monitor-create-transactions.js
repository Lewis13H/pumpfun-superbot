// scripts/monitor-create-transactions.js
// Real-time monitoring to see exactly what's happening with CREATE transactions

require('dotenv').config();
const { db } = require('../src/database/postgres-js');

class CreateTransactionMonitor {
  constructor() {
    this.lastTokenCount = 0;
    this.lastCreateCount = 0;
    this.checkInterval = 5000; // Check every 5 seconds
    this.totalChecks = 0;
  }

  async start() {
    console.log('🔍 STARTING REAL-TIME CREATE TRANSACTION MONITOR');
    console.log('================================================');
    console.log('This will run for 2 minutes and show exactly what\'s happening...\n');

    const startTime = Date.now();
    const monitorDuration = 120000; // 2 minutes

    const monitor = setInterval(async () => {
      try {
        this.totalChecks++;
        await this.checkCreateFlow();
        
        // Stop after 2 minutes
        if (Date.now() - startTime > monitorDuration) {
          clearInterval(monitor);
          await this.showFinalSummary();
          process.exit(0);
        }
      } catch (error) {
        console.error('Monitor error:', error.message);
      }
    }, this.checkInterval);
  }

  async checkCreateFlow() {
    try {
      // Check new tokens in last 30 seconds
      const newTokens = await db('tokens')
        .where('created_at', '>', db.raw("NOW() - INTERVAL '30 seconds'"))
        .count('* as count')
        .first();

      // Check CREATE transactions in last 30 seconds  
      const createTxs = await db('timeseries.token_transactions')
        .where('time', '>', db.raw("NOW() - INTERVAL '30 seconds'"))
        .andWhere('type', 'create')
        .count('* as count')
        .first();

      // Check ALL transactions in last 30 seconds
      const allTxs = await db('timeseries.token_transactions')
        .where('time', '>', db.raw("NOW() - INTERVAL '30 seconds'"))
        .groupBy('type')
        .count('* as count')
        .select('type');

      const tokenCount = parseInt(newTokens.count);
      const createCount = parseInt(createTxs.count);
      
      const time = new Date().toLocaleTimeString();
      
      // Build transaction summary
      const txSummary = allTxs.length > 0 
        ? allTxs.map(tx => `${tx.type}: ${tx.count}`).join(', ')
        : 'No transactions';

      console.log(`⏰ ${time} | 🆕 Tokens: ${tokenCount} | 📝 CREATE txs: ${createCount} | 💰 All txs: [${txSummary}]`);

      // Analysis
      if (tokenCount > this.lastTokenCount && createCount === this.lastCreateCount) {
        console.log('🚨 ISSUE DETECTED: New tokens created but no CREATE transactions logged!');
        
        // Get some recent token examples
        const recentTokens = await db('tokens')
          .where('created_at', '>', db.raw("NOW() - INTERVAL '30 seconds'"))
          .orderBy('created_at', 'desc')
          .limit(3)
          .select('address', 'symbol', 'created_at', 'discovery_signature');

        if (recentTokens.length > 0) {
          console.log('   📋 Recent tokens:');
          recentTokens.forEach(token => {
            console.log(`     • ${token.address.substring(0, 8)}... | ${token.symbol} | Sig: ${token.discovery_signature?.substring(0, 8) || 'None'}...`);
          });
        }
      } else if (createCount > this.lastCreateCount) {
        console.log('✅ CREATE transactions flowing correctly!');
      }

      // Update counters
      this.lastTokenCount = tokenCount;
      this.lastCreateCount = createCount;

    } catch (error) {
      console.error('❌ Check failed:', error.message);
    }
  }

  async showFinalSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL MONITORING SUMMARY');
    console.log('='.repeat(60));

    try {
      // Get totals for the monitoring period
      const totalNewTokens = await db('tokens')
        .where('created_at', '>', db.raw("NOW() - INTERVAL '2 minutes'"))
        .count('* as count')
        .first();

      const totalCreateTxs = await db('timeseries.token_transactions')
        .where('time', '>', db.raw("NOW() - INTERVAL '2 minutes'"))
        .andWhere('type', 'create')
        .count('* as count')
        .first();

      const allTransactionTypes = await db('timeseries.token_transactions')
        .where('time', '>', db.raw("NOW() - INTERVAL '2 minutes'"))
        .groupBy('type')
        .count('* as count')
        .select('type');

      console.log(`📈 Total checks performed: ${this.totalChecks}`);
      console.log(`🆕 New tokens (2 min): ${totalNewTokens.count}`);
      console.log(`📝 CREATE transactions (2 min): ${totalCreateTxs.count}`);
      console.log('💰 Transaction breakdown:');
      
      if (allTransactionTypes.length > 0) {
        allTransactionTypes.forEach(tx => {
          console.log(`   • ${tx.type}: ${tx.count}`);
        });
      } else {
        console.log('   • No transactions found');
      }

      // Diagnosis
      console.log('\n🎯 DIAGNOSIS:');
      if (parseInt(totalNewTokens.count) > 0 && parseInt(totalCreateTxs.count) === 0) {
        console.log('❌ CONFIRMED BUG: Tokens are being created but CREATE transactions are not being logged');
        console.log('🔧 Possible causes:');
        console.log('   1. The emit("transaction", tokenTx) line is not being executed');
        console.log('   2. There\'s an error in extractTokenAndQueueMetadata preventing emission');
        console.log('   3. The bot is not running with the latest code changes');
        console.log('   4. The handleTransaction method is still skipping CREATE transactions');
      } else if (parseInt(totalCreateTxs.count) > 0) {
        console.log('✅ CREATE transactions are being logged correctly!');
        console.log('   The diagnostic test may be checking a different time window.');
      } else {
        console.log('⚠️  No activity detected - pump.fun might be slow right now');
      }

    } catch (error) {
      console.error('❌ Summary failed:', error.message);
    }

    console.log('='.repeat(60));
  }
}

// Start monitoring
const monitor = new CreateTransactionMonitor();
monitor.start().catch(console.error);