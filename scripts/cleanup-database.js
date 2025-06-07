// scripts/cleanup-database.js
// Clean up old tokens from the database

const { db } = require('../dist/database/postgres');
const chalk = require('chalk');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function getStats() {
  const stats = await db.raw(`
    SELECT 
      COUNT(*) as total_tokens,
      COUNT(CASE WHEN created_at < NOW() - INTERVAL '24 hours' THEN 1 END) as older_than_24h,
      COUNT(CASE WHEN created_at < NOW() - INTERVAL '7 days' THEN 1 END) as older_than_7d,
      COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 days' THEN 1 END) as older_than_30d,
      COUNT(CASE WHEN symbol = 'UNKNOWN' THEN 1 END) as unknown_symbols,
      COUNT(CASE WHEN market_cap IS NULL THEN 1 END) as no_market_cap,
      COUNT(CASE WHEN category = 'ARCHIVE' THEN 1 END) as archived,
      COUNT(CASE WHEN category = 'BIN' THEN 1 END) as binned
    FROM tokens
  `);
  
  const priceStats = await db.raw(`
    SELECT 
      COUNT(DISTINCT token_address) as tokens_with_prices,
      COUNT(*) as total_price_points,
      pg_size_pretty(pg_total_relation_size('timeseries.token_prices')) as price_table_size
    FROM timeseries.token_prices
  `);
  
  const txStats = await db.raw(`
    SELECT 
      COUNT(*) as total_transactions,
      pg_size_pretty(pg_total_relation_size('timeseries.token_transactions')) as tx_table_size
    FROM timeseries.token_transactions
  `);
  
  return {
    tokens: stats.rows[0],
    prices: priceStats.rows[0],
    transactions: txStats.rows[0]
  };
}

async function showStats() {
  const stats = await getStats();
  
  console.log(chalk.cyan('\n📊 DATABASE STATISTICS'));
  console.log(chalk.cyan('=====================\n'));
  
  console.log(chalk.yellow('Tokens Table:'));
  console.log(chalk.white(`  Total tokens: ${stats.tokens.total_tokens}`));
  console.log(chalk.white(`  Older than 24h: ${stats.tokens.older_than_24h}`));
  console.log(chalk.white(`  Older than 7d: ${stats.tokens.older_than_7d}`));
  console.log(chalk.white(`  Older than 30d: ${stats.tokens.older_than_30d}`));
  console.log(chalk.white(`  Unknown symbols: ${stats.tokens.unknown_symbols}`));
  console.log(chalk.white(`  No market cap: ${stats.tokens.no_market_cap}`));
  console.log(chalk.white(`  Archived: ${stats.tokens.archived}`));
  console.log(chalk.white(`  Binned: ${stats.tokens.binned}`));
  
  console.log(chalk.yellow('\nTime Series Data:'));
  console.log(chalk.white(`  Tokens with prices: ${stats.prices.tokens_with_prices}`));
  console.log(chalk.white(`  Total price points: ${stats.prices.total_price_points}`));
  console.log(chalk.white(`  Price table size: ${stats.prices.price_table_size}`));
  console.log(chalk.white(`  Transaction count: ${stats.transactions.total_transactions}`));
  console.log(chalk.white(`  Transaction table size: ${stats.transactions.tx_table_size}`));
}

async function cleanupDatabase() {
  console.log(chalk.cyan('\n🧹 DATABASE CLEANUP UTILITY'));
  console.log(chalk.cyan('==========================='));
  
  // Show current stats
  await showStats();
  
  // Show cleanup options
  console.log(chalk.yellow('\n📋 CLEANUP OPTIONS:'));
  console.log(chalk.white('  1. Remove all tokens older than 24 hours'));
  console.log(chalk.white('  2. Remove all tokens older than 7 days'));
  console.log(chalk.white('  3. Remove tokens with incomplete data (no symbol, no market cap)'));
  console.log(chalk.white('  4. Remove ARCHIVE and BIN tokens only'));
  console.log(chalk.white('  5. FULL RESET - Remove ALL tokens and start fresh'));
  console.log(chalk.white('  6. Custom query'));
  console.log(chalk.white('  0. Exit without changes'));
  
  const choice = await question(chalk.cyan('\nSelect option (0-6): '));
  
  let deleteQuery = '';
  let description = '';
  
  switch(choice) {
    case '1':
      deleteQuery = "created_at < NOW() - INTERVAL '24 hours'";
      description = 'tokens older than 24 hours';
      break;
    case '2':
      deleteQuery = "created_at < NOW() - INTERVAL '7 days'";
      description = 'tokens older than 7 days';
      break;
    case '3':
      deleteQuery = "symbol = 'UNKNOWN' OR market_cap IS NULL";
      description = 'tokens with incomplete data';
      break;
    case '4':
      deleteQuery = "category IN ('ARCHIVE', 'BIN')";
      description = 'archived and binned tokens';
      break;
    case '5':
      deleteQuery = "1=1"; // Delete everything
      description = 'ALL TOKENS';
      break;
    case '6':
      console.log(chalk.yellow('\nExample conditions:'));
      console.log(chalk.gray("  - created_at < NOW() - INTERVAL '12 hours'"));
      console.log(chalk.gray("  - market_cap < 1000"));
      console.log(chalk.gray("  - symbol = 'UNKNOWN' AND created_at < NOW() - INTERVAL '1 hour'"));
      deleteQuery = await question(chalk.cyan('\nEnter WHERE clause: '));
      description = 'tokens matching custom query';
      break;
    case '0':
      console.log(chalk.green('\n✅ Exiting without changes'));
      rl.close();
      process.exit(0);
      break;
    default:
      console.log(chalk.red('\n❌ Invalid option'));
      rl.close();
      process.exit(1);
  }
  
  // Count tokens to be deleted
  const countResult = await db('tokens')
    .whereRaw(deleteQuery)
    .count('* as count')
    .first();
  
  const deleteCount = parseInt(countResult.count);
  
  if (deleteCount === 0) {
    console.log(chalk.yellow('\n⚠️  No tokens match the criteria'));
    rl.close();
    process.exit(0);
  }
  
  console.log(chalk.red(`\n⚠️  WARNING: This will delete ${deleteCount} ${description}`));
  console.log(chalk.red('This action cannot be undone!'));
  
  // Show sample of tokens to be deleted
  const sample = await db('tokens')
    .whereRaw(deleteQuery)
    .select('address', 'symbol', 'market_cap', 'created_at')
    .limit(5);
  
  console.log(chalk.yellow('\nSample of tokens to be deleted:'));
  sample.forEach(token => {
    console.log(chalk.gray(`  ${token.symbol || 'UNKNOWN'} - ${token.address.substring(0, 20)}... - MC: $${token.market_cap || 0}`));
  });
  
  const confirm = await question(chalk.red('\nType "DELETE" to confirm: '));
  
  if (confirm !== 'DELETE') {
    console.log(chalk.green('\n✅ Cancelled - no changes made'));
    rl.close();
    process.exit(0);
  }
  
  // Perform deletion
  console.log(chalk.yellow('\n🗑️  Deleting tokens...'));
  
  try {
    await db.transaction(async (trx) => {
      // Get addresses of tokens to be deleted
      const tokensToDelete = await trx('tokens')
        .whereRaw(deleteQuery)
        .pluck('address');
      
      if (tokensToDelete.length > 0) {
        // Delete from time series tables first (foreign key constraints)
        console.log(chalk.gray('  Deleting price data...'));
        await trx('timeseries.token_prices')
          .whereIn('token_address', tokensToDelete)
          .delete();
        
        console.log(chalk.gray('  Deleting transaction data...'));
        await trx('timeseries.token_transactions')
          .whereIn('token_address', tokensToDelete)
          .delete();
        
        console.log(chalk.gray('  Deleting signal data...'));
        await trx('token_signals')
          .whereIn('token_address', tokensToDelete)
          .delete();
        
        console.log(chalk.gray('  Deleting category transitions...'));
        await trx('category_transitions')
          .whereIn('token_address', tokensToDelete)
          .delete();
      }
      
      // Finally delete the tokens
      console.log(chalk.gray('  Deleting tokens...'));
      const deleted = await trx('tokens')
        .whereRaw(deleteQuery)
        .delete();
      
      console.log(chalk.green(`\n✅ Successfully deleted ${deleted} tokens and related data`));
    });
    
    // Vacuum to reclaim space (optional, takes time)
    const vacuum = await question(chalk.yellow('\nRun VACUUM to reclaim disk space? (y/n): '));
    if (vacuum.toLowerCase() === 'y') {
      console.log(chalk.yellow('Running VACUUM ANALYZE (this may take a while)...'));
      await db.raw('VACUUM ANALYZE');
      console.log(chalk.green('✅ VACUUM complete'));
    }
    
    // Show new stats
    console.log(chalk.cyan('\n📊 NEW DATABASE STATISTICS:'));
    await showStats();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error during deletion:'), error.message);
  }
  
  rl.close();
  await db.destroy();
}

// Add option to backup before cleanup
async function main() {
  console.log(chalk.yellow('💡 TIP: Consider backing up your database before cleanup:'));
  console.log(chalk.gray('   pg_dump -h localhost -p 5433 -U memecoin_user -d memecoin_discovery -f backup.sql\n'));
  
  const proceed = await question(chalk.cyan('Continue with cleanup? (y/n): '));
  
  if (proceed.toLowerCase() === 'y') {
    await cleanupDatabase();
  } else {
    console.log(chalk.green('✅ Exiting without changes'));
    rl.close();
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}