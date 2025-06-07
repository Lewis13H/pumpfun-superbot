// scripts/check-system-status.js
// Comprehensive system status check

const { db } = require('../dist/database/postgres');
const chalk = require('chalk');

async function checkSystemStatus() {
  console.log(chalk.cyan('\n🔍 MEMECOIN BOT SYSTEM STATUS CHECK'));
  console.log(chalk.cyan('=====================================\n'));
  
  try {
    // 1. Database connection
    console.log(chalk.yellow('1. Database Connection:'));
    const dbTest = await db.raw('SELECT NOW() as time, version() as version');
    console.log(chalk.green('   ✅ Connected'));
    console.log(chalk.white(`   Time: ${dbTest.rows[0].time}`));
    console.log(chalk.white(`   Version: ${dbTest.rows[0].version.split(',')[0]}`));
    
    // 2. TimescaleDB status
    console.log(chalk.yellow('\n2. TimescaleDB:'));
    const tsdb = await db.raw(`
      SELECT default_version, installed_version 
      FROM pg_available_extensions 
      WHERE name = 'timescaledb'
    `);
    console.log(chalk.green(`   ✅ Installed: ${tsdb.rows[0].installed_version}`));
    
    // 3. Token discovery status
    console.log(chalk.yellow('\n3. Token Discovery:'));
    const discovery = await db.raw(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as last_5_min,
        MAX(created_at) as latest_discovery
      FROM tokens
    `);
    const disc = discovery.rows[0];
    console.log(chalk.white(`   Total tokens: ${disc.total_tokens}`));
    console.log(chalk.white(`   Last hour: ${disc.last_hour}`));
    console.log(chalk.white(`   Last 5 min: ${disc.last_5_min}`));
    console.log(chalk.white(`   Latest: ${disc.latest_discovery || 'Never'}`));
    
    // 4. Price data status
    console.log(chalk.yellow('\n4. Price Data (TimeSeries):'));
    const prices = await db.raw(`
      SELECT 
        COUNT(DISTINCT token_address) as tokens_with_prices,
        COUNT(*) as total_price_points,
        MAX(time) as latest_price_update
      FROM timeseries.token_prices
      WHERE time > NOW() - INTERVAL '1 hour'
    `);
    const price = prices.rows[0];
    console.log(chalk.white(`   Tokens with prices: ${price.tokens_with_prices}`));
    console.log(chalk.white(`   Price points (1h): ${price.total_price_points}`));
    console.log(chalk.white(`   Latest update: ${price.latest_price_update || 'Never'}`));
    
    // 5. Category distribution
    console.log(chalk.yellow('\n5. Category Distribution:'));
    const categories = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category')
      .orderBy('count', 'desc');
    
    categories.forEach(cat => {
      const color = cat.category === 'AIM' ? chalk.green : chalk.white;
      console.log(color(`   ${cat.category}: ${cat.count}`));
    });
    
    // 6. Data completeness
    console.log(chalk.yellow('\n6. Data Completeness (last 24h):'));
    const completeness = await db.raw(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN symbol != 'UNKNOWN' THEN 1 ELSE 0 END) as has_symbol,
        SUM(CASE WHEN market_cap IS NOT NULL THEN 1 ELSE 0 END) as has_market_cap,
        SUM(CASE WHEN holders IS NOT NULL THEN 1 ELSE 0 END) as has_holders,
        SUM(CASE WHEN liquidity IS NOT NULL THEN 1 ELSE 0 END) as has_liquidity,
        SUM(CASE WHEN solsniffer_score IS NOT NULL THEN 1 ELSE 0 END) as has_solsniffer
      FROM tokens
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    const comp = completeness.rows[0];
    if (comp.total > 0) {
      console.log(chalk.white(`   Total tokens: ${comp.total}`));
      console.log(chalk.white(`   Has symbol: ${comp.has_symbol} (${Math.round(comp.has_symbol/comp.total*100)}%)`));
      console.log(chalk.white(`   Has market cap: ${comp.has_market_cap} (${Math.round(comp.has_market_cap/comp.total*100)}%)`));
      console.log(chalk.white(`   Has holders: ${comp.has_holders} (${Math.round(comp.has_holders/comp.total*100)}%)`));
      console.log(chalk.white(`   Has liquidity: ${comp.has_liquidity} (${Math.round(comp.has_liquidity/comp.total*100)}%)`));
      console.log(chalk.white(`   Has SolSniffer: ${comp.has_solsniffer} (${Math.round(comp.has_solsniffer/comp.total*100)}%)`));
    } else {
      console.log(chalk.gray('   No tokens in last 24 hours'));
    }
    
    // 7. AIM range tokens
    console.log(chalk.yellow('\n7. AIM Range Tokens ($35k-$105k):'));
    const aimTokens = await db('tokens')
      .whereBetween('market_cap', [35000, 105000])
      .where('liquidity', '>=', 7500)
      .where('holders', '>=', 50)
      .whereNotNull('solsniffer_score')
      .select('address', 'symbol', 'market_cap', 'liquidity', 'holders', 'solsniffer_score')
      .orderBy('market_cap', 'desc')
      .limit(5);
    
    if (aimTokens.length > 0) {
      console.log(chalk.green(`   Found ${aimTokens.length} potential buy candidates:`));
      aimTokens.forEach(token => {
        console.log(chalk.white(`   • ${token.symbol} - MC: $${token.market_cap?.toLocaleString()}, Holders: ${token.holders}, SolSniffer: ${token.solsniffer_score}`));
      });
    } else {
      console.log(chalk.gray('   No tokens currently in buy range with complete data'));
    }
    
    // 8. Recent buy signals
    console.log(chalk.yellow('\n8. Recent Buy Signals:'));
    const signals = await db('token_signals')
      .where('signal_type', 'BUY')
      .where('generated_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
      .join('tokens', 'token_signals.token_address', 'tokens.address')
      .select('tokens.symbol', 'token_signals.*')
      .orderBy('generated_at', 'desc')
      .limit(5);
    
    if (signals.length > 0) {
      console.log(chalk.green(`   ${signals.length} buy signals in last 24h:`));
      signals.forEach(signal => {
        console.log(chalk.white(`   • ${signal.symbol} - ${signal.reason} (${new Date(signal.generated_at).toLocaleString()})`));
      });
    } else {
      console.log(chalk.gray('   No buy signals in last 24 hours'));
    }
    
    // 9. System health
    console.log(chalk.yellow('\n9. System Health:'));
    const health = await db.raw("SELECT * FROM check_system_health()");
    health.rows.forEach(metric => {
      const statusColor = metric.status.includes('OK') ? chalk.green : 
                         metric.status.includes('SLOW') ? chalk.yellow : chalk.red;
      console.log(statusColor(`   ${metric.metric}: ${metric.value} - ${metric.status}`));
    });
    
    console.log(chalk.cyan('\n=====================================\n'));
    
  } catch (error) {
    console.error(chalk.red('Error checking system status:'), error);
  } finally {
    await db.destroy();
  }
}

// Run the check
checkSystemStatus();