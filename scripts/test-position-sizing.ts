import { db } from '../src/database/postgres';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';
import { positionSizer } from '../src/trading/position-sizer';

async function testPositionSizing() {
  console.log('=== Testing Position Sizing Logic ===\n');
  
  // Test different scenarios
  const scenarios = [
    {
      name: 'Perfect Score',
      evaluation: {
        passed: true,
        solsnifferScore: 95,
        holders: 1000,
        top10Percent: 15,
        marketCap: 45000,
      }
    },
    {
      name: 'Limited by SolSniffer',
      evaluation: {
        passed: true,
        solsnifferScore: 65,  // Tier 1: 0.1 SOL limit
        holders: 1000,
        top10Percent: 15,
        marketCap: 45000,
      }
    },
    {
      name: 'Limited by Holders',
      evaluation: {
        passed: true,
        solsnifferScore: 95,
        holders: 100,  // Tier 1: 0.1 SOL limit
        top10Percent: 15,
        marketCap: 45000,
      }
    },
    {
      name: 'Limited by Concentration',
      evaluation: {
        passed: true,
        solsnifferScore: 95,
        holders: 1000,
        top10Percent: 30,  // Above 25%: 0.1 SOL limit
        marketCap: 45000,
      }
    },
    {
      name: 'Multiple Limits (like our test)',
      evaluation: {
        passed: true,
        solsnifferScore: 75,  // Tier 2: 0.25 SOL limit
        holders: 200,  // Tier 2: 0.25 SOL limit
        top10Percent: 22,  // Below 25%: no limit
        marketCap: 42000,
      }
    }
  ];
  
  for (const scenario of scenarios) {
    console.log(`\n${scenario.name}:`);
    console.log(`  SolSniffer: ${scenario.evaluation.solsnifferScore}`);
    console.log(`  Holders: ${scenario.evaluation.holders}`);
    console.log(`  Top 10%: ${scenario.evaluation.top10Percent}%`);
    
    const position = positionSizer.calculatePosition(scenario.evaluation as any);
    
    console.log(`\nPosition Result:`);
    console.log(`  Base: ${position.basePosition} SOL`);
    console.log(`  Final: ${position.finalPosition} SOL`);
    console.log(`  Reasoning:`);
    position.reasoning.forEach(r => console.log(`    - ${r}`));
    console.log('  ---');
  }
  
  // Test with a real token if exists
  const aimToken = await db('tokens')
    .where('category', 'AIM')
    .whereNotNull('solsniffer_score')
    .first();
  
  if (aimToken) {
    console.log(`\n\nReal Token Test: ${aimToken.symbol}`);
    const evaluation = await buySignalEvaluator.evaluateToken(aimToken.address);
    
    if (evaluation.passed) {
      const position = positionSizer.calculatePosition(evaluation);
      console.log(`  Final Position: ${position.finalPosition} SOL`);
      console.log(`  Reasoning:`, position.reasoning);
    }
  }
  
  await db.destroy();
}

testPositionSizing();