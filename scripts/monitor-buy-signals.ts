import { buySignalService } from '../src/trading/buy-signal-service';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';
import { db } from '../src/database/postgres';

async function monitorBuySignals() {
  console.clear();
  console.log('=== Buy Signal Monitor ===\n');
  
  // Get stats
  const stats = await buySignalService.getStats();
  console.log('Evaluation Stats:');
  console.log(`  Total Evaluations: ${stats.totalEvaluations}`);
  console.log(`  Passed: ${stats.passedEvaluations}`);
  console.log(`  Pass Rate: ${stats.passRate}`);
  console.log(`  Last 24h: ${stats.last24Hours}`);
  
  // Get active signals
  const activeSignals = buySignalService.getActiveSignals();
  console.log(`\nActive Signals: ${activeSignals.length}`);
  
  if (activeSignals.length > 0) {
    console.log('\nSignal Details:');
    activeSignals.forEach(signal => {
      console.log(`\n${signal.symbol}:`);
      console.log(`  Address: ${signal.tokenAddress}`);
      console.log(`  Market Cap: ${signal.evaluation.marketCap}`);
      console.log(`  Position: ${signal.position.finalPosition} SOL`);
      console.log(`  Confidence: ${(signal.evaluation.confidence * 100).toFixed(1)}%`);
      console.log(`  Reasons: ${signal.position.reasoning.join(', ')}`);
    });
  }
  
  // Get AIM tokens
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .count('* as count')
    .first();
  
  console.log(`\nTokens in AIM: ${aimTokens?.count || 0}`);
  
  // Recent evaluations
  const recentEvals = await buySignalEvaluator.getEvaluationHistory(10);
  console.log('\nRecent Evaluations:');
  
  for (const evaluation of recentEvals) {
    const token = await db('tokens')
      .where('address', evaluation.token_address)
      .first();
    
    console.log(`  ${token?.symbol || evaluation.token_address.slice(0, 8)}: ${
      evaluation.passed ? '✅ PASS' : '❌ FAIL'
    } (MC: ${evaluation.market_cap})`);
  }
}

// Update every 10 seconds
setInterval(monitorBuySignals, 10000);
monitorBuySignals();
