// scripts/monitor-priority-system.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';
import { TokenEnrichmentService } from '../src/analysis/token-enrichment-service';

/**
 * Script to monitor the priority-based token monitoring system
 * Shows distribution of tokens across priority levels and performance metrics
 */

async function monitorPrioritySystem() {
  console.log('🔍 Token Priority System Monitor');
  console.log('================================\n');

  try {
    // 1. Get priority distribution
    const distribution = await db('tokens')
      .select('monitoring_priority')
      .count('* as count')
      .groupBy('monitoring_priority');

    const totalTokens = distribution.reduce((sum, item) => sum + Number(item.count), 0);
    
    console.log('📊 Priority Distribution:');
    console.log('------------------------');
    distribution.forEach(item => {
      const count = Number(item.count);
      const percentage = ((count / totalTokens) * 100).toFixed(2);
      const priority = String(item.monitoring_priority || 'UNSET').toUpperCase();
      console.log(`${priority}: ${count} tokens (${percentage}%)`);
    });
    console.log(`Total: ${totalTokens} tokens\n`);

    // 2. Get graduation candidates
    const graduationCandidates = await db('tokens')
      .join('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
      .where('tokens.is_pump_fun', true)
      .where('enhanced_token_metrics.graduation_distance', '>=', 0.5)
      .where('enhanced_token_metrics.graduation_distance', '<', 1.0)
      .select(
        'tokens.address',
        'tokens.symbol',
        'tokens.monitoring_priority',
        'enhanced_token_metrics.graduation_distance',
        'enhanced_token_metrics.market_cap'
      )
      .orderBy('enhanced_token_metrics.graduation_distance', 'desc')
      .limit(20);

    console.log('🎯 Top Graduation Candidates (>50%):');
    console.log('-----------------------------------');
    graduationCandidates.forEach(token => {
      const progress = (token.graduation_distance * 100).toFixed(1);
      const marketCap = token.market_cap ? `$${(token.market_cap / 1000).toFixed(1)}k` : 'Unknown';
      const priority = String(token.monitoring_priority || 'NORMAL').toUpperCase();
      console.log(`${token.symbol}: ${progress}% (${marketCap}) - Priority: ${priority}`);
    });

    // 3. Get recently upgraded tokens
    const recentUpgrades = await db('tokens')
      .where('monitoring_priority', 'high')
      .whereNotNull('passed_filter_at')
      .where('passed_filter_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .select('address', 'symbol', 'passed_filter_at')
      .orderBy('passed_filter_at', 'desc')
      .limit(10);

    console.log('\n⬆️ Recently Upgraded to High Priority (last 24h):');
    console.log('-----------------------------------------------');
    recentUpgrades.forEach(token => {
      const hoursAgo = ((Date.now() - new Date(token.passed_filter_at).getTime()) / (1000 * 60 * 60)).toFixed(1);
      console.log(`${token.symbol}: upgraded ${hoursAgo} hours ago`);
    });

    // 4. Get tokens that will be downgraded soon
    const downgradeThreshold = new Date(Date.now() - 11 * 60 * 60 * 1000); // 11 hours ago
    const pendingDowngrades = await db('tokens')
      .leftJoin('enhanced_token_metrics', 'tokens.address', 'enhanced_token_metrics.token_address')
      .where('tokens.monitoring_priority', 'high')
      .where('tokens.passed_filter_at', '<', downgradeThreshold)
      .where(function() {
        this.whereNull('enhanced_token_metrics.graduation_distance')
          .orWhere('enhanced_token_metrics.graduation_distance', '<', 0.5);
      })
      .select(
        'tokens.address',
        'tokens.symbol',
        'tokens.passed_filter_at',
        'enhanced_token_metrics.graduation_distance'
      )
      .limit(10);

    console.log('\n⬇️ Tokens Pending Downgrade (high priority >11h, <50% graduation):');
    console.log('----------------------------------------------------------------');
    pendingDowngrades.forEach(token => {
      const hoursInHighPriority = ((Date.now() - new Date(token.passed_filter_at).getTime()) / (1000 * 60 * 60)).toFixed(1);
      const progress = token.graduation_distance ? `${(token.graduation_distance * 100).toFixed(1)}%` : 'Unknown';
      console.log(`${token.symbol}: ${hoursInHighPriority}h in high priority, graduation: ${progress}`);
    });

    // 5. Update frequency analysis
    const updateFrequency = await db('enhanced_token_metrics')
      .select('token_address')
      .select(db.raw('COUNT(*) as update_count'))
      .select(db.raw('MAX(last_updated) - MIN(last_updated) as time_span'))
      .where('last_updated', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
      .groupBy('token_address')
      .orderBy('update_count', 'desc')
      .limit(10);

    console.log('\n📈 Most Frequently Updated Tokens (last 24h):');
    console.log('--------------------------------------------');
    for (const record of updateFrequency) {
      const tokenInfo = await db('tokens')
        .where('address', record.token_address)
        .select('symbol', 'monitoring_priority')
        .first();
      
      if (tokenInfo) {
        const priority = String(tokenInfo.monitoring_priority || 'NORMAL').toUpperCase();
        console.log(`${tokenInfo.symbol}: ${record.update_count} updates - Priority: ${priority}`);
      }
    }

    // 6. System performance metrics
    const last5MinTokens = await db('tokens')
      .where('updated_at', '>', new Date(Date.now() - 5 * 60 * 1000))
      .count('* as count')
      .first();

    const last15MinTokens = await db('tokens')
      .where('updated_at', '>', new Date(Date.now() - 15 * 60 * 1000))
      .count('* as count')
      .first();

    console.log('\n⚡ System Performance:');
    console.log('---------------------');
    console.log(`Tokens updated in last 5 min: ${last5MinTokens ? Number(last5MinTokens.count) : 0}`);
    console.log(`Tokens updated in last 15 min: ${last15MinTokens ? Number(last15MinTokens.count) : 0}`);

    // 7. Priority-based update intervals
    console.log('\n⏱️ Configured Update Intervals:');
    console.log('------------------------------');
    console.log('High Priority: Every 15 seconds');
    console.log('Normal Priority: Every 2 minutes');
    console.log('Low Priority: Every 5 minutes');
    console.log('Graduation Check: Every minute (>50% progress)');
    console.log('Priority Rebalance: Every 15 minutes');
    console.log('Downgrade After: 12 hours of high priority');

  } catch (error) {
    console.error('Error monitoring priority system:', error);
  } finally {
    await db.destroy();
  }
}

// Execute the monitor
monitorPrioritySystem().catch(console.error);