// scripts/monitor-clean-simple.ts
import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
const chalk = require('chalk');

async function cleanMonitor() {
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
    
    let coloredLine;
    switch(cat) {
      case 'NEW':
      case 'ARCHIVE':
      case 'BIN':
        coloredLine = chalk.gray('  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar);
        break;
      case 'LOW':
        coloredLine = chalk.blue('  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar);
        break;
      case 'MEDIUM':
        coloredLine = chalk.yellow('  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar);
        break;
      case 'HIGH':
        coloredLine = chalk.magenta('  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar);
        break;
      case 'AIM':
        coloredLine = chalk.green('  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar);
        break;
      default:
        coloredLine = '  ' + cat.padEnd(8) + ' ' + count.toString().padStart(4) + ' ' + bar;
    }
    console.log(coloredLine);
  });

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
      const mc = token.market_cap > 0 ? '$' + token.market_cap.toLocaleString() : '$0';
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' + 
        token.category.padEnd(8) + ' ' + 
        chalk.green(mc.padStart(10)) + ' ' + 
        chalk.gray(age + 's ago')
      );
    });
  }

  // Tokens Approaching AIM
  const approachingAim = await db('tokens')
    .where('category', 'HIGH')
    .where('market_cap', '>', 30000)
    .orderBy('market_cap', 'desc')
    .limit(3);

  if (approachingAim.length > 0) {
    console.log(chalk.yellow.bold('\n🎯 Approaching AIM Zone ($35k):'));
    approachingAim.forEach(token => {
      const progressPercent = (token.market_cap / 35000) * 100;
      const progressValue = Math.floor(progressPercent / 10);
      const progressBar = '▓'.repeat(progressValue) + '░'.repeat(10 - progressValue);
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' + 
        chalk.green('$' + token.market_cap.toLocaleString()) + ' ' + 
        chalk.cyan(progressBar) + ' ' + 
        chalk.yellow(progressPercent.toFixed(0) + '%')
      );
    });
  }

  // AIM Tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .select('symbol', 'market_cap', 'category_updated_at');

  if (aimTokens.length > 0) {
    console.log(chalk.yellow.bold('\n💎 Tokens in AIM Zone:'));
    aimTokens.forEach(token => {
      const timeInAim = Math.round((Date.now() - new Date(token.category_updated_at).getTime()) / 60000);
      console.log('  ' + 
        chalk.white(token.symbol.padEnd(10)) + ' ' + 
        chalk.green('$' + token.market_cap.toLocaleString()) + ' ' + 
        chalk.gray(timeInAim + 'm in AIM')
      );
    });
  }

  // Summary
  const totalTokens = Object.values(distribution).reduce((a: any, b: any) => a + b, 0);
  console.log(chalk.gray('\n📈 Total Tokens: ' + totalTokens));
}

// Run every 5 seconds
setInterval(cleanMonitor, 5000);
cleanMonitor();