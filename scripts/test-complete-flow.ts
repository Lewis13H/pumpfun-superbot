// scripts/test-complete-flow.ts
import { categoryAPIRouter } from '../src/analysis/category-api-router';
import { buySignalEvaluator } from '../src/trading/buy-signal-evaluator';
import { db } from '../src/database/postgres';

async function testCompleteFlow(tokenAddress?: string) {
  console.log('=== Testing Complete SolSniffer Flow ===\n');
  
  try {
    // If no token provided, find an AIM token
    if (!tokenAddress) {
      const aimToken = await db('tokens')
        .where('category', 'AIM')
        .first();
        
      if (!aimToken) {
        console.log('No AIM tokens found in database');
        return;
      }
      
      tokenAddress = aimToken.address;
      console.log(`Using AIM token: ${aimToken.symbol} (${tokenAddress})`);
    }
    
    // Step 1: Run full analysis
    console.log('\n1. Running full analysis with SolSniffer...');
    const analysis = await categoryAPIRouter.analyzeToken(tokenAddress, 'AIM', true);
    
    console.log('\nAnalysis Results:');
    console.log(`  Market Cap: $${analysis.marketCap}`);
    console.log(`  Liquidity: $${analysis.liquidity}`);
    console.log(`  APIs Used: ${analysis.apisUsed.join(', ')}`);
    console.log(`  SolSniffer Score: ${analysis.solsnifferScore || 'N/A'}`);
    console.log(`  Processing Time: ${analysis.processingTime}ms`);
    
    // Step 2: Check database update
    console.log('\n2. Checking database update...');
    const dbToken = await db('tokens')
      .where('address', tokenAddress)
      .first();
      
    console.log('\nDatabase Values:');
    console.log(`  Symbol: ${dbToken.symbol}`);
    console.log(`  Category: ${dbToken.category}`);
    console.log(`  Market Cap: $${dbToken.market_cap}`);
    console.log(`  SolSniffer Score: ${dbToken.solsniffer_score || 'NOT SET'}`);
    console.log(`  SolSniffer Checked: ${dbToken.solsniffer_checked_at ? new Date(dbToken.solsniffer_checked_at).toLocaleString() : 'NEVER'}`);
    console.log(`  Has Security Data: ${dbToken.security_data ? 'YES' : 'NO'}`);
    
    // Parse and display security data
    if (dbToken.security_data) {
      const securityData = typeof dbToken.security_data === 'string' 
        ? JSON.parse(dbToken.security_data)
        : dbToken.security_data;
        
      console.log('\nStored Security Data:');
      console.log(`  Risk Level: ${securityData.riskLevel}`);
      console.log(`  Warnings: ${securityData.warnings?.length || 0}`);
      console.log(`  Risk Counts: High=${securityData.highRiskCount || 0}, Medium=${securityData.mediumRiskCount || 0}, Low=${securityData.lowRiskCount || 0}`);
    }
    
    // Step 3: Evaluate buy signal if AIM
    if (dbToken.category === 'AIM' && dbToken.solsniffer_score) {
      console.log('\n3. Evaluating buy signal...');
      
      try {
        const evaluation = await buySignalEvaluator.evaluateToken(tokenAddress);
        
        console.log('\nBuy Signal Evaluation:');
        console.log(`  Passed: ${evaluation.passed ? '✅ YES' : '❌ NO'}`);
        console.log(`  Confidence: ${(evaluation.confidence * 100).toFixed(1)}%`);
        
        console.log('\nCriteria Results:');
        console.log(`  Market Cap: ${evaluation.criteria.marketCap ? '✅' : '❌'} ($${evaluation.marketCap})`);
        console.log(`  Liquidity: ${evaluation.criteria.liquidity ? '✅' : '❌'} ($${evaluation.liquidity})`);
        console.log(`  Holders: ${evaluation.criteria.holders ? '✅' : '❌'} (${evaluation.holders})`);
        console.log(`  Concentration: ${evaluation.criteria.concentration ? '✅' : '❌'} (${evaluation.top10Percent}%)`);
        console.log(`  SolSniffer: ${evaluation.criteria.solsniffer ? '✅' : '❌'} (Score: ${evaluation.solsnifferScore})`);
        
        if (!evaluation.passed && evaluation.failureReasons.length > 0) {
          console.log('\nFailure Reasons:');
          evaluation.failureReasons.forEach(reason => console.log(`  - ${reason}`));
        }
        
        // Special note about score 90
        if (evaluation.solsnifferScore === 90) {
          console.log('\n  ⚠️  NOTE: Score of 90 is BLACKLISTED in buy criteria');
        }
        
      } catch (evalError: any) {
        console.log(`\n  ❌ Buy evaluation failed: ${evalError.message}`);
      }
    }
    
    // Step 4: Summary
    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log(`  Token: ${dbToken.symbol} (${tokenAddress.slice(0, 10)}...)`);
    console.log(`  Category: ${dbToken.category}`);
    console.log(`  SolSniffer Integration: ${dbToken.solsniffer_score ? '✅ Working' : '❌ No Score'}`);
    console.log(`  Security Data Storage: ${dbToken.security_data ? '✅ Stored' : '❌ Missing'}`);
    
    if (dbToken.category === 'AIM' && dbToken.solsniffer_score) {
      const eligible = dbToken.solsniffer_score > 60 && dbToken.solsniffer_score !== 90;
      console.log(`  Buy Signal Eligible: ${eligible ? '✅ YES' : '❌ NO'}`);
    }
    
  } catch (error) {
    console.error('Error in flow test:', error);
  }
}

// Get token address from command line or use default
const tokenAddress = process.argv[2];

testCompleteFlow(tokenAddress)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });