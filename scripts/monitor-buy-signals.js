// scripts/monitor-buy-signals.js
// Monitor tokens in AIM range and evaluate buy signals

const { db } = require('../dist/database/postgres');
const { BuySignalEvaluator } = require('../dist/trading/buy-signal-evaluator');
const { logger } = require('../dist/utils/logger');
const chalk = require('chalk');

const evaluator = new BuySignalEvaluator();

async function checkAimTokens() {
  try {
    // Get tokens in AIM range
    const aimTokens = await db('tokens')
      .where('category', 'AIM')
      .orWhere(function() {
        this.whereBetween('market_cap', [35000, 105000]);
      })
      .orderBy('market_cap', 'desc');
    
    if (aimTokens.length === 0) {
      return { aimCount: 0, evaluated: 0, signals: 0 };
    }
    
    let evaluated = 0;
    let signals = 0;
    
    for (const token of aimTokens) {
      // Skip if we've already evaluated recently
      if (token.buy_attempts >= 3) {
        continue;
      }
      
      // Skip if missing critical data
      if (!token.holders || !token.top_10_percent || !token.liquidity) {
        continue;
      }
      
      evaluated++;
      
      try {
        const evaluation = await evaluator.evaluateToken(token.address);
        
        if (evaluation && evaluation.passed) {
          signals++;
          
          // Log buy signal
          console.log(chalk.green('\n💰 BUY SIGNAL DETECTED!'));
          console.log(chalk.white(`   Token: ${token.symbol} (${token.address})`));
          console.log(chalk.white(`   Market Cap: $${token.market_cap?.toLocaleString()}`));
          console.log(chalk.white(`   Liquidity: $${token.liquidity?.toLocaleString()}`));
          console.log(chalk.white(`   Holders: ${token.holders}`));
          console.log(chalk.white(`   Top 10%: ${token.top_10_percent}%`));
          console.log(chalk.white(`   SolSniffer: ${token.solsniffer_score}`));
          console.log(chalk.yellow(`   Position Size: ${evaluation.positionSize} SOL`));
          console.log(chalk.cyan(`   Reason: ${evaluation.reason}`));
        }
        
      } catch (error) {
        logger.error(`Error evaluating ${token.address}:`, error);
      }
      
      // Small delay between evaluations
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return { aimCount: aimTokens.length, evaluated, signals };
  } catch (error) {
    logger.error('Error checking AIM tokens:', error);
    return { aimCount: 0, evaluated: 0, signals: 0 };
  }
}

async function displayStats() {
  try {
    const stats = await db('tokens')
      .select(
        db.raw(`
          COUNT(*) as total,
          SUM(CASE WHEN category = 'NEW' THEN 1 ELSE 0 END) as new_tokens,
          SUM(CASE WHEN category = 'AIM' THEN 1 ELSE 0 END) as aim_tokens,
          SUM(CASE WHEN market_cap BETWEEN 35000 AND 105000 THEN 1 ELSE 0 END) as in_range,
          COUNT(DISTINCT CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN address END) as hourly_discoveries
        `)
      )
      .first();
    
    const signals = await db('token_signals')
      .where('signal_type', 'BUY')
      .where('generated_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .count('* as count')
      .first();
    
    console.log(chalk.blue('\n📊 System Statistics:'));
    console.log(chalk.white(`   Total Tokens: ${stats.total}`));
    console.log(chalk.white(`   NEW Tokens: ${stats.new_tokens}`));
    console.log(chalk.white(`   AIM Category: ${stats.aim_tokens}`));
    console.log(chalk.white(`   In Buy Range: ${stats.in_range}`));
    console.log(chalk.white(`   Discoveries (1h): ${stats.hourly_discoveries}`));
    console.log(chalk.white(`   Buy Signals (24h): ${signals.count}`));
  } catch (error) {
    logger.error('Error getting stats:', error);
  }
}

async function monitor() {
  console.log(chalk.cyan('🎯 Buy Signal Monitor Started'));
  console.log(chalk.gray('Monitoring tokens in $35k-$105k range...\n'));
  
  // Initial stats
  await displayStats();
  
  // Main monitoring loop
  setInterval(async () => {
    const startTime = Date.now();
    
    console.log(chalk.gray(`\n[${new Date().toLocaleTimeString()}] Checking AIM tokens...`));
    
    const result = await checkAimTokens();
    
    const duration = Date.now() - startTime;
    
    if (result.evaluated > 0) {
      console.log(chalk.gray(`   Evaluated ${result.evaluated}/${result.aimCount} tokens in ${duration}ms`));
      if (result.signals > 0) {
        console.log(chalk.green(`   Generated ${result.signals} buy signals!`));
      }
    }
    
  }, 30000); // Check every 30 seconds
  
  // Display stats every 5 minutes
  setInterval(displayStats, 5 * 60 * 1000);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\nShutting down...'));
  await db.destroy();
  process.exit(0);
});

// Start monitoring
monitor().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});