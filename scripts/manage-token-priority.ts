// scripts/manage-token-priority.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

/**
 * Utility script to manage token monitoring priorities
 * Usage: npx ts-node scripts/manage-token-priority.ts [command] [options]
 * 
 * Commands:
 * - upgrade <address|symbol> - Upgrade token to high priority
 * - downgrade <address|symbol> - Downgrade token to normal priority
 * - check <address|symbol> - Check token priority status
 * - reset-all - Reset all tokens to normal priority
 * - fix-graduation - Fix all graduation candidates to high priority
 */

const args = process.argv.slice(2);
const command = args[0];
const tokenIdentifier = args[1];

async function findToken(identifier: string) {
  // Try to find by address first, then by symbol
  let token = await db('tokens')
    .where('address', identifier)
    .first();
  
  if (!token) {
    token = await db('tokens')
      .whereRaw('LOWER(symbol) = LOWER(?)', [identifier])
      .first();
  }
  
  return token;
}

async function upgradeToken(identifier: string) {
  const token = await findToken(identifier);
  
  if (!token) {
    console.error(`❌ Token not found: ${identifier}`);
    return;
  }
  
  await db('tokens')
    .where('address', token.address)
    .update({
      monitoring_priority: 'high',
      passed_filter_at: new Date()
    });
  
  console.log(`✅ Upgraded ${token.symbol} (${token.address}) to HIGH priority`);
}

async function downgradeToken(identifier: string) {
  const token = await findToken(identifier);
  
  if (!token) {
    console.error(`❌ Token not found: ${identifier}`);
    return;
  }
  
  await db('tokens')
    .where('address', token.address)
    .update({
      monitoring_priority: 'normal'
    });
  
  console.log(`✅ Downgraded ${token.symbol} (${token.address}) to NORMAL priority`);
}

async function checkToken(identifier: string) {
  const token = await findToken(identifier);
  
  if (!token) {
    console.error(`❌ Token not found: ${identifier}`);
    return;
  }
  
  const metrics = await db('enhanced_token_metrics')
    .where('token_address', token.address)
    .first();
  
  console.log('\n📋 Token Priority Status');
  console.log('------------------------');
  console.log(`Symbol: ${token.symbol}`);
  console.log(`Address: ${token.address}`);
  console.log(`Priority: ${String(token.monitoring_priority || 'NORMAL').toUpperCase()}`);
  console.log(`Status: ${token.status}`);
  
  if (token.passed_filter_at) {
    const hoursAgo = ((Date.now() - new Date(token.passed_filter_at).getTime()) / (1000 * 60 * 60)).toFixed(1);
    console.log(`High Priority Since: ${hoursAgo} hours ago`);
  }
  
  if (metrics) {
    console.log(`\n📊 Metrics:`);
    console.log(`Market Cap: $${(metrics.market_cap / 1000).toFixed(1)}k`);
    console.log(`Graduation Progress: ${(metrics.graduation_distance * 100).toFixed(1)}%`);
    console.log(`Liquidity: $${(metrics.total_liquidity / 1000).toFixed(1)}k`);
    console.log(`Volume 24h: $${(metrics.volume_24h / 1000).toFixed(1)}k`);
    console.log(`Last Updated: ${new Date(metrics.last_updated).toLocaleString()}`);
  }
}

async function resetAllPriorities() {
  const confirm = process.argv[2] === '--confirm';
  
  if (!confirm) {
    console.log('⚠️  This will reset ALL tokens to normal priority!');
    console.log('Run with --confirm to proceed');
    return;
  }
  
  const result = await db('tokens')
    .update({
      monitoring_priority: 'normal'
    });
  
  console.log(`✅ Reset ${result} tokens to NORMAL priority`);
}

async function fixGraduationCandidates() {
  // Find all tokens >50% to graduation
  const candidates = await db('tokens')
    .join('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
    .where('tokens.is_pump_fun', true)
    .where('enhanced_token_metrics.graduation_distance', '>=', 0.5)
    .where('enhanced_token_metrics.graduation_distance', '<', 1.0)
    .where('tokens.monitoring_priority', '!=', 'high')
    .select('tokens.address', 'tokens.symbol', 'enhanced_token_metrics.graduation_distance');
  
  console.log(`Found ${candidates.length} graduation candidates not in high priority`);
  
  for (const candidate of candidates) {
    await db('tokens')
      .where('address', candidate.address)
      .update({
        monitoring_priority: 'high',
        passed_filter_at: new Date()
      });
    
    const progress = (candidate.graduation_distance * 100).toFixed(1);
    console.log(`✅ Upgraded ${candidate.symbol} (${progress}% graduation) to HIGH priority`);
  }
  
  console.log(`\n✅ Fixed ${candidates.length} graduation candidates`);
}

async function showHelp() {
  console.log('Token Priority Management Utility');
  console.log('================================\n');
  console.log('Commands:');
  console.log('  upgrade <address|symbol>    - Upgrade token to high priority');
  console.log('  downgrade <address|symbol>  - Downgrade token to normal priority');
  console.log('  check <address|symbol>      - Check token priority status');
  console.log('  reset-all [--confirm]       - Reset all tokens to normal priority');
  console.log('  fix-graduation              - Fix all graduation candidates to high priority');
  console.log('  help                        - Show this help message');
  console.log('\nExamples:');
  console.log('  npx ts-node scripts/manage-token-priority.ts check BONK');
  console.log('  npx ts-node scripts/manage-token-priority.ts upgrade 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr');
  console.log('  npx ts-node scripts/manage-token-priority.ts fix-graduation');
}

async function main() {
  try {
    switch (command) {
      case 'upgrade':
        if (!tokenIdentifier) {
          console.error('❌ Please provide a token address or symbol');
          break;
        }
        await upgradeToken(tokenIdentifier);
        break;
        
      case 'downgrade':
        if (!tokenIdentifier) {
          console.error('❌ Please provide a token address or symbol');
          break;
        }
        await downgradeToken(tokenIdentifier);
        break;
        
      case 'check':
        if (!tokenIdentifier) {
          console.error('❌ Please provide a token address or symbol');
          break;
        }
        await checkToken(tokenIdentifier);
        break;
        
      case 'reset-all':
        await resetAllPriorities();
        break;
        
      case 'fix-graduation':
        await fixGraduationCandidates();
        break;
        
      case 'help':
      default:
        await showHelp();
        break;
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

main().catch(console.error);