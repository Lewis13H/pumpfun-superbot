import { db } from '../src/database/postgres';
import chalk from 'chalk';

async function watchNearTransitions() {
  console.clear();
  console.log(chalk.cyan.bold('=== CATEGORY TRANSITION WATCH ===\n'));
  
  // Watch SBUCKS approaching HIGH
  const sbucks = await db('tokens')
    .where('symbol', 'SBUCKS')
    .first();
    
  if (sbucks) {
    const marketCap = Number(sbucks.market_cap);
    const progress = (marketCap / 19000) * 100;
    const distance = 19000 - marketCap;
    const bar = '▓'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
    
    console.log(chalk.yellow.bold('🎯 APPROACHING HIGH CATEGORY:'));
    console.log(`  ${chalk.white('SBUCKS')} ${chalk.green('$' + marketCap.toFixed(2))} ${chalk.cyan(bar)} ${chalk.yellow(progress.toFixed(1) + '%')}`);
    console.log(`  ${chalk.gray('Only $' + distance.toFixed(2) + ' to HIGH category!')}\n`);
  }
  
  // Show recent transitions
  const transitions = await db('category_transitions')
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000))
    .orderBy('created_at', 'desc')
    .limit(5);
    
  if (transitions.length > 0) {
    console.log(chalk.yellow.bold('Recent Transitions (30 min):'));
    for (const t of transitions) {
      const token = await db('tokens').where('address', t.token_address).first();
      console.log(`  ${token?.symbol || 'Unknown'} ${t.from_category} → ${t.to_category} at $${Number(t.market_cap_at_transition).toFixed(2)}`);
    }
  }
  
  console.log(chalk.gray('\nPress Ctrl+C to exit'));
}

setInterval(watchNearTransitions, 2000);
watchNearTransitions();
