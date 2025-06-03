// scripts/test-solsniffer.ts
import { SolSnifferClient } from '../src/api/solsniffer-client';
import { config } from '../src/config';
import { db } from '../src/database/postgres';

async function testSolSniffer() {
  console.log('=== Testing SolSniffer Integration ===\n');
  
  const client = new SolSnifferClient(config.apis.solsnifferApiKey);
  
  // Test tokens - you can replace with actual token addresses
  const testTokens = [
    'So11111111111111111111111111111111111111112', // Wrapped SOL (should be safe)
    // Add your AIM token addresses here for testing
  ];
  
  // Add any AIM tokens from your database
  const aimTokens = await db('tokens')
    .where('category', 'AIM')
    .limit(3)
    .select('address', 'symbol');
  
  if (aimTokens.length > 0) {
    console.log(`Found ${aimTokens.length} AIM tokens to test\n`);
    testTokens.push(...aimTokens.map(t => t.address));
  }
  
  for (const tokenAddress of testTokens) {
    console.log(`\nTesting token: ${tokenAddress}`);
    console.log('='.repeat(50));
    
    try {
      const analysis = await client.analyzeToken(tokenAddress);
      
      console.log('\nAnalysis Results:');
      console.log(`  Score: ${analysis.score}/100 (${analysis.score >= 60 ? '✅ PASS' : '❌ FAIL'})`);
      console.log(`  Risk Level: ${analysis.riskLevel}`);
      console.log(`  Rug Pull Risk: ${analysis.rugPullRisk}%`);
      console.log(`  Honeypot: ${analysis.honeypot ? '❌ YES' : '✅ NO'}`);
      console.log(`  Mint Disabled: ${analysis.mintAuthorityRenounced ? '✅ YES' : '❌ NO'}`);
      console.log(`  Freeze Disabled: ${analysis.freezeAuthorityRenounced ? '✅ YES' : '❌ NO'}`);
      console.log(`  Top Holder %: ${analysis.topHolderPercentage}%`);
      
      if (analysis.warnings.length > 0) {
        console.log('\nWarnings:');
        analysis.warnings.forEach(w => console.log(`  - ${w}`));
      }
      
      console.log('\nRisk Breakdown:');
      console.log(`  High Risk Indicators: ${analysis.highRiskCount || 0}`);
      console.log(`  Medium Risk Indicators: ${analysis.mediumRiskCount || 0}`);
      console.log(`  Low Risk Indicators: ${analysis.lowRiskCount || 0}`);
      
      // Check buy signal criteria
      console.log('\nBuy Signal Criteria:');
      const passScore = analysis.score > 60 && analysis.score !== 90;
      console.log(`  Score > 60 and ≠ 90: ${passScore ? '✅ PASS' : '❌ FAIL'} (Score: ${analysis.score})`);
      
      // Check if token exists in database
      const dbToken = await db('tokens')
        .where('address', tokenAddress)
        .first();
      
      if (dbToken) {
        console.log('\nDatabase Status:');
        console.log(`  Symbol: ${dbToken.symbol}`);
        console.log(`  Category: ${dbToken.category}`);
        console.log(`  Current DB Score: ${dbToken.solsniffer_score || 'NOT SET'}`);
        
        // Update the database with the new score
        if (dbToken.category === 'AIM') {
          await db('tokens')
            .where('address', tokenAddress)
            .update({
              solsniffer_score: analysis.score,
              solsniffer_checked_at: new Date()
            });
          console.log(`  ✅ Updated database with score: ${analysis.score}`);
        }
      }
      
    } catch (error) {
      console.error(`Error analyzing token: ${error}`);
    }
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n\n=== Test Complete ===');
}

// Run the test
testSolSniffer()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });