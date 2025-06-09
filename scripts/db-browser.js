// scripts/db-browser.js
// Quick database browser for PowerShell

require('dotenv').config();
const { db } = require('../src/database/postgres-js');

async function showMenu() {
  console.log('\n🗄️  DATABASE BROWSER');
  console.log('==================');
  console.log('1. Recent tokens (last 10)');
  console.log('2. Recent CREATE transactions (last 10)');
  console.log('3. Recent ALL transactions (last 20)');
  console.log('4. Hourly stats');
  console.log('5. Top tokens by market cap');
  console.log('6. Token search by address');
  console.log('7. Exit\n');
}

async function recentTokens() {
  console.log('\n📋 RECENT TOKENS (Last 10):');
  console.log('='.repeat(80));
  
  const tokens = await db('tokens')
    .orderBy('created_at', 'desc')
    .limit(10)
    .select('address', 'symbol', 'name', 'market_cap', 'category', 'created_at');
  
  console.table(tokens.map(t => ({
    Address: t.address.substring(0, 8) + '...',
    Symbol: t.symbol,
    Name: t.name.substring(0, 20),
    'Market Cap': t.market_cap ? `$${t.market_cap.toFixed(0)}` : 'N/A',
    Category: t.category,
    Created: t.created_at.toLocaleTimeString()
  })));
}

async function recentCreateTxs() {
  console.log('\n📝 RECENT CREATE TRANSACTIONS (Last 10):');
  console.log('='.repeat(80));
  
  const txs = await db('timeseries.token_transactions')
    .where('type', 'create')
    .orderBy('time', 'desc')
    .limit(10)
    .select('signature', 'token_address', 'user_address', 'time');
  
  console.table(txs.map(tx => ({
    Signature: tx.signature.substring(0, 8) + '...',
    Token: tx.token_address.substring(0, 8) + '...',
    User: tx.user_address.substring(0, 8) + '...',
    Time: tx.time.toLocaleTimeString()
  })));
}

async function recentAllTxs() {
  console.log('\n💰 RECENT ALL TRANSACTIONS (Last 20):');
  console.log('='.repeat(80));
  
  const txs = await db('timeseries.token_transactions')
    .orderBy('time', 'desc')
    .limit(20)
    .select('signature', 'token_address', 'type', 'time');
  
  console.table(txs.map(tx => ({
    Signature: tx.signature.substring(0, 8) + '...',
    Token: tx.token_address.substring(0, 8) + '...',
    Type: tx.type.toUpperCase(),
    Time: tx.time.toLocaleTimeString()
  })));
}

async function hourlyStats() {
  console.log('\n📊 HOURLY STATISTICS:');
  console.log('='.repeat(50));
  
  const [tokens1h, creates1h, buys1h, sells1h] = await Promise.all([
    db('tokens').where('created_at', '>', db.raw("NOW() - INTERVAL '1 hour'")).count('* as count').first(),
    db('timeseries.token_transactions').where('type', 'create').where('time', '>', db.raw("NOW() - INTERVAL '1 hour'")).count('* as count').first(),
    db('timeseries.token_transactions').where('type', 'buy').where('time', '>', db.raw("NOW() - INTERVAL '1 hour'")).count('* as count').first(),
    db('timeseries.token_transactions').where('type', 'sell').where('time', '>', db.raw("NOW() - INTERVAL '1 hour'")).count('* as count').first()
  ]);
  
  console.table([
    { Metric: 'New Tokens', Count: tokens1h.count },
    { Metric: 'CREATE Transactions', Count: creates1h.count },
    { Metric: 'BUY Transactions', Count: buys1h.count },
    { Metric: 'SELL Transactions', Count: sells1h.count },
    { Metric: 'CREATE Coverage', Count: `${((creates1h.count / tokens1h.count) * 100).toFixed(1)}%` }
  ]);
}

async function topTokens() {
  console.log('\n🏆 TOP TOKENS BY MARKET CAP:');
  console.log('='.repeat(80));
  
  const tokens = await db('tokens')
    .whereNotNull('market_cap')
    .where('market_cap', '>', 1000)
    .orderBy('market_cap', 'desc')
    .limit(10)
    .select('address', 'symbol', 'name', 'market_cap', 'category', 'current_price_usd');
  
  console.table(tokens.map(t => ({
    Address: t.address.substring(0, 8) + '...',
    Symbol: t.symbol,
    Name: t.name.substring(0, 20),
    'Market Cap': `$${t.market_cap.toFixed(0)}`,
    'Price USD': `$${(t.current_price_usd || 0).toFixed(8)}`,
    Category: t.category
  })));
}

async function searchToken() {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const address = await new Promise(resolve => {
    readline.question('Enter token address (full or partial): ', resolve);
  });
  readline.close();
  
  if (address.length < 4) {
    console.log('❌ Address too short');
    return;
  }
  
  const tokens = await db('tokens')
    .where('address', 'like', `%${address}%`)
    .limit(5)
    .select('*');
  
  if (tokens.length === 0) {
    console.log('❌ No tokens found');
    return;
  }
  
  console.log(`\n🔍 SEARCH RESULTS (${tokens.length} found):`);
  console.log('='.repeat(80));
  
  tokens.forEach(token => {
    console.log(`📍 Address: ${token.address}`);
    console.log(`   Symbol: ${token.symbol}`);
    console.log(`   Name: ${token.name}`);
    console.log(`   Market Cap: $${(token.market_cap || 0).toFixed(0)}`);
    console.log(`   Category: ${token.category}`);
    console.log(`   Created: ${token.created_at?.toLocaleString()}`);
    console.log('   ' + '-'.repeat(60));
  });
}

async function main() {
  try {
    console.log('✅ Connected to database');
    
    while (true) {
      await showMenu();
      
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const choice = await new Promise(resolve => {
        readline.question('Select option (1-7): ', resolve);
      });
      readline.close();
      
      switch (choice) {
        case '1':
          await recentTokens();
          break;
        case '2':
          await recentCreateTxs();
          break;
        case '3':
          await recentAllTxs();
          break;
        case '4':
          await hourlyStats();
          break;
        case '5':
          await topTokens();
          break;
        case '6':
          await searchToken();
          break;
        case '7':
          console.log('👋 Goodbye!');
          process.exit(0);
        default:
          console.log('❌ Invalid option');
      }
    }
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    process.exit(1);
  }
}

main();