import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import chalk from 'chalk';

async function enhancedMonitor() {
  console.clear();
  
  // Header
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('     SOLANA TOKEN DISCOVERY - CATEGORY MONITOR v1.2     '));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════'));
  console.log(chalk.gray('Time: ' + new Date().toLocaleTimeString() + '\n'));

  // Category Distribution
  const distribution = await categoryManager.getCategoryDistribution();
  console.log(chalk.yellow.bold('📊 Token Distribution:'));
  
  const categories = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM', 'ARCHIVE', 'BIN'];
  categories.forEach(cat => {
    const count = (distribution as any)[cat] || 0;
    const bar = '█'.repeat(Math.min(count / 10, 20));
    const line = '  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar;
    
    // Apply color based on category
    switch(cat) {
      case 'NEW':
      case 'ARCHIVE':
      case 'BIN':
        console.log(chalk.gray(line));
        break;
      case 'LOW':
        console.log(chalk.blue(line));
        break;
      case 'MEDIUM':
        console.log(chalk.yellow(line));
        break;
      case 'HIGH':
        console.log(chalk.magenta(line));
        break;
      case 'AIM':
        console.log(chalk.green(line));
        break;
      default:
        console.log(line);
    }
  });

  // MEDIUM Tokens Approaching HIGH
  const mediumTokens = await db('tokens')
    .where('category', 'MEDIUM')
    .where('market_cap', '>', 15000)  // Show tokens over $15k
    .orderBy('market_cap', 'desc')
    .limit(3);

  if (mediumTokens.length > 0) {
    console.log(chalk.yellow.bold('\n🎯 MEDIUM Tokens Approaching HIGH ($19k):'));
    mediumTokens.forEach(token => {
      const marketCap = Number(token.market_cap);
      const progress = (marketCap / 19000) * 100;
      const distance = 19000 - marketCap;
      const bar = '▓'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' +
        chalk.green('$' + marketCap.toFixed(2)) + ' ' +
        chalk.cyan(bar) + ' ' +
        chalk.yellow(progress.toFixed(1) + '%') + ' ' +
        chalk.gray('($' + distance.toFixed(0) + ' away)')
      );
    });
  }

  // HIGH Tokens (if any)
  const highTokens = await db('tokens')
    .where('category', 'HIGH')
    .orderBy('market_cap', 'desc')
    .limit(5);

  if (highTokens.length > 0) {
    console.log(chalk.magenta.bold('\n🏆 HIGH CATEGORY Tokens ($19k-$35k):'));
    highTokens.forEach(token => {
      const marketCap = Number(token.market_cap);
      const progressToAim = ((marketCap - 19000) / 16000) * 100;
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' +
        chalk.green('$' + marketCap.toFixed(2)) + ' ' +
        chalk.magenta('→ AIM: ' + progressToAim.toFixed(1) + '%')
      );
    });
  }

  // Recent Discoveries (last 5 minutes)
  console.log(chalk.yellow.bold('\n🆕 Recent Discoveries:'));
  const recentTokens = await db('tokens')
    .where('discovered_at', '>', new Date(Date.now() - 5 * 60 * 1000))
    .orderBy('discovered_at', 'desc')
    .limit(5)
    .select('symbol', 'market_cap', 'category', 'discovered_at');

  if (recentTokens.length === 0) {
    console.log(chalk.gray('  No new tokens in last 5 minutes'));
  } else {
    recentTokens.forEach(token => {
      const age = Math.round((Date.now() - new Date(token.discovered_at).getTime()) / 1000);
      const mc = Number(token.market_cap) > 0 ? '$' + Number(token.market_cap).toLocaleString() : '$0';
      const parts = [
        chalk.white(token.symbol.padEnd(10)),
        token.category.padEnd(8),
        chalk.green(mc.padStart(10)),
        chalk.gray(age + 's ago')
      ];
      console.log('  ' + parts.join(' '));
    });
  }

  // AIM Tokens (if any)
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('symbol', 'market_cap', 'category_updated_at');

  if (aimTokens.length > 0) {
    console.log(chalk.green.bold('\n💎 Tokens in AIM Zone (BUY EVALUATION):'));
    aimTokens.forEach(token => {
      const timeInAim = Math.round((Date.now() - new Date(token.category_updated_at).getTime()) / 60000);
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' +
        chalk.green('$' + Number(token.market_cap).toLocaleString()) + ' ' +
        chalk.gray(timeInAim + 'm in AIM')
      );
    });
  }

  // Summary
  const totalTokens = Object.values(distribution).reduce((a: any, b: any) => a + b, 0);
  console.log(chalk.gray('\n📈 Total Tokens: ' + totalTokens));
}

// Run every 5 seconds
setInterval(enhancedMonitor, 5000);
enhancedMonitor();
