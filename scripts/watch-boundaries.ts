import { db } from '../src/database/postgres';
import chalk from 'chalk';

async function watchBoundaries() {
  console.clear();
  console.log(chalk.cyan.bold('=== CATEGORY BOUNDARY WATCHER ===\n'));
  
  // Tokens near MEDIUM ($8k)
  const nearMedium = await db('tokens')
    .where('category', 'LOW')
    .where('market_cap', '>', 7000)
    .orderBy('market_cap', 'desc')
    .limit(5);
    
  if (nearMedium.length > 0) {
    console.log(chalk.yellow.bold('📈 Approaching MEDIUM ($8,000):'));
    nearMedium.forEach(t => {
      const progress = (t.market_cap / 8000) * 100;
      const distance = 8000 - t.market_cap;
      const bar = '▓'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
      console.log(`  ${chalk.white(t.symbol.padEnd(10))} ${chalk.green('$' + t.market_cap.toFixed(2))} ${chalk.cyan(bar)} ${chalk.yellow(progress.toFixed(1) + '%')} ${chalk.gray('($' + distance.toFixed(0) + ' away)')}`);
    });
  }
  
  // Check recent transitions
  const recentTransitions = await db('category_transitions')
    .where('created_at', '>', new Date(Date.now() - 10 * 60 * 1000))
    .orderBy('created_at', 'desc')
    .limit(5);
    
  if (recentTransitions.length > 0) {
    console.log(chalk.yellow.bold('\n🔄 Recent Category Changes (10 min):'));
    for (const trans of recentTransitions) {
      const token = await db('tokens').where('address', trans.token_address).first();
      console.log(`  ${chalk.white(token?.symbol || 'Unknown')} ${chalk.gray(trans.from_category)} → ${chalk.green(trans.to_category)} at $${trans.market_cap_at_transition}`);
    }
  }
  
  // Show MEDIUM tokens
  const mediumTokens = await db('tokens')
    .where('category', 'MEDIUM')
    .orderBy('market_cap', 'desc')
    .limit(5);
    
  if (mediumTokens.length > 0) {
    console.log(chalk.yellow.bold('\n🏆 Current MEDIUM Tokens:'));
    mediumTokens.forEach(t => {
      console.log(`  ${chalk.white(t.symbol.padEnd(10))} ${chalk.green('$' + t.market_cap.toFixed(2))}`);
    });
  }
}

// Run every 3 seconds
setInterval(watchBoundaries, 3000);
watchBoundaries();
