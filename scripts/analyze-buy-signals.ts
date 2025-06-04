import { db } from '../src/database/postgres';

async function analyzeBuySignals() {
  console.log('=== Buy Signal Analysis ===\n');
  
  // Overall stats
  const overall = await db('buy_evaluations')
    .select(
      db.raw('COUNT(*) as total'),
      db.raw('SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed'),
      db.raw('AVG(CASE WHEN passed THEN position_size ELSE NULL END) as avg_position')
    )
    .first();
  
  console.log('Overall Statistics:');
  console.log(`  Total Evaluations: ${overall.total}`);
  console.log(`  Passed: ${overall.passed} (${((overall.passed / overall.total) * 100).toFixed(1)}%)`);
  console.log(`  Average Position: ${Number(overall.avg_position || 0).toFixed(2)} SOL`);
  
  // Failure reasons
  console.log('\n\nTop Failure Reasons:');
  
  const failures = await db('buy_evaluations')
    .where('passed', false)
    .select('failure_reasons');
  
  const reasonCounts: Record<string, number> = {};
  
  failures.forEach(f => {
    try {
      // Handle both JSON and plain text failure reasons
      let reasons: string[] = [];
      
      if (f.failure_reasons) {
        // Try to parse as JSON first
        if (typeof f.failure_reasons === 'string') {
          if (f.failure_reasons.startsWith('[') || f.failure_reasons.startsWith('{')) {
            try {
              const parsed = JSON.parse(f.failure_reasons);
              reasons = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              // If JSON parse fails, treat as single string
              reasons = [f.failure_reasons];
            }
          } else {
            // Plain text - treat as single reason
            reasons = [f.failure_reasons];
          }
        } else if (Array.isArray(f.failure_reasons)) {
          reasons = f.failure_reasons;
        } else if (typeof f.failure_reasons === 'object') {
          // JSONB field - already parsed
          reasons = f.failure_reasons;
        }
      }
      
      reasons.forEach((r: string) => {
        if (r) {
          const key = r.split(' ').slice(0, 3).join(' ');
          reasonCounts[key] = (reasonCounts[key] || 0) + 1;
        }
      });
    } catch (error) {
      console.error('Error parsing failure reason:', error);
    }
  });
  
  Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([reason, count]) => {
      console.log(`  ${reason}...: ${count}`);
    });
  
  // Success by market cap range
  console.log('\n\nSuccess Rate by Market Cap:');
  
  const byMcRange = await db('buy_evaluations')
    .select(
      db.raw(`
        CASE 
          WHEN market_cap < 50000 THEN '35k-50k'
          WHEN market_cap < 70000 THEN '50k-70k'
          ELSE '70k-105k'
        END as range
      `),
      db.raw('COUNT(*) as total'),
      db.raw('SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed')
    )
    .groupBy('range')
    .orderBy('range');
  
  byMcRange.forEach(r => {
    const rate = ((r.passed / r.total) * 100).toFixed(1);
    console.log(`  ${r.range}: ${r.passed}/${r.total} (${rate}%)`);
  });
  
  // Position sizing breakdown
  console.log('\n\nPosition Size Distribution:');
  
  const positions = await db('buy_evaluations')
    .where('passed', true)
    .select('position_size');
  
  const positionBuckets: Record<string, number> = {
    '0.1 SOL': 0,
    '0.25 SOL': 0,
    '1.0 SOL': 0,
  };
  
  positions.forEach(p => {
    const size = Number(p.position_size);
    if (size <= 0.1) positionBuckets['0.1 SOL']++;
    else if (size <= 0.25) positionBuckets['0.25 SOL']++;
    else positionBuckets['1.0 SOL']++;
  });
  
  Object.entries(positionBuckets).forEach(([bucket, count]) => {
    console.log(`  ${bucket}: ${count} signals`);
  });
  
  // Time to buy signal
  console.log('\n\nTime from Discovery to Buy Signal:');
  
  try {
    const timeToBuy = await db('buy_evaluations as be')
      .join('tokens as t', 'be.token_address', 't.address')
      .where('be.passed', true)
      .select(
        db.raw('AVG(EXTRACT(EPOCH FROM (be.created_at - t.discovered_at)) / 3600) as avg_hours'),
        db.raw('MIN(EXTRACT(EPOCH FROM (be.created_at - t.discovered_at)) / 3600) as min_hours'),
        db.raw('MAX(EXTRACT(EPOCH FROM (be.created_at - t.discovered_at)) / 3600) as max_hours')
      )
      .first();
    
    if (timeToBuy && timeToBuy.avg_hours !== null) {
      console.log(`  Average: ${Number(timeToBuy.avg_hours).toFixed(1)} hours`);
      console.log(`  Minimum: ${Number(timeToBuy.min_hours).toFixed(1)} hours`);
      console.log(`  Maximum: ${Number(timeToBuy.max_hours).toFixed(1)} hours`);
    } else {
      console.log('  No passed evaluations to analyze');
    }
  } catch (error) {
    console.log('  Error calculating time to buy signal');
  }
}

analyzeBuySignals()
  .then(() => process.exit(0))
  .catch(console.error);