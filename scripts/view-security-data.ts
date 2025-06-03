// scripts/view-security-data.ts
import { db } from '../src/database/postgres';

async function viewSecurityData() {
  console.log('=== SolSniffer Security Data Analysis ===\n');
  
  try {
    // Get tokens with SolSniffer data
    const tokensWithData = await db('tokens')
      .whereNotNull('solsniffer_score')
      .orderBy('solsniffer_checked_at', 'desc')
      .limit(10)
      .select(
        'address',
        'symbol',
        'category',
        'solsniffer_score',
        'solsniffer_checked_at',
        'security_data',
        'market_cap',
        'buy_attempts'
      );
    
    console.log(`Found ${tokensWithData.length} tokens with SolSniffer data\n`);
    
    for (const token of tokensWithData) {
      console.log('='.repeat(60));
      console.log(`Token: ${token.symbol} (${token.address.slice(0, 10)}...)`);
      console.log(`Category: ${token.category} | Market Cap: $${token.market_cap}`);
      console.log(`SolSniffer Score: ${token.solsniffer_score}/100`);
      console.log(`Checked: ${new Date(token.solsniffer_checked_at).toLocaleString()}`);
      console.log(`Buy Attempts: ${token.buy_attempts || 0}`);
      
      // Parse and display security data
      if (token.security_data) {
        try {
          const securityData = typeof token.security_data === 'string' 
            ? JSON.parse(token.security_data)
            : token.security_data;
          
          console.log('\nSecurity Details:');
          console.log(`  Risk Level: ${securityData.riskLevel || 'N/A'}`);
          console.log(`  Rug Pull Risk: ${securityData.rugPullRisk || 0}%`);
          console.log(`  Honeypot: ${securityData.honeypot ? '❌ YES' : '✅ NO'}`);
          console.log(`  Liquidity Locked: ${securityData.liquidityLocked ? '✅ YES' : '❌ NO'}`);
          console.log(`  LP Burned: ${securityData.lpBurned ? '✅ YES' : '❌ NO'}`);
          console.log(`  Mint Disabled: ${securityData.mintDisabled ? '✅ YES' : '❌ NO'}`);
          console.log(`  Freeze Disabled: ${securityData.freezeDisabled ? '✅ YES' : '❌ NO'}`);
          
          if (securityData.warnings && securityData.warnings.length > 0) {
            console.log('\n  Warnings:');
            securityData.warnings.forEach((w: string) => console.log(`    - ${w}`));
          }
          
          console.log('\n  Risk Indicators:');
          console.log(`    High: ${securityData.highRiskCount || 0}`);
          console.log(`    Medium: ${securityData.mediumRiskCount || 0}`);
          console.log(`    Low: ${securityData.lowRiskCount || 0}`);
          
          if (securityData.specificRisks && Object.keys(securityData.specificRisks).length > 0) {
            console.log('\n  Specific Risks:');
            Object.entries(securityData.specificRisks).forEach(([key, value]) => {
              console.log(`    - ${key}: ${value}`);
            });
          }
        } catch (e) {
          console.log('\n  ❌ Failed to parse security data');
        }
      } else {
        console.log('\n  ⚠️  No detailed security data stored');
      }
      
      // Check buy signal criteria
      if (token.category === 'AIM') {
        console.log('\n  Buy Signal Analysis:');
        const scorePass = token.solsniffer_score > 60 && token.solsniffer_score !== 90;
        console.log(`    Score > 60 and ≠ 90: ${scorePass ? '✅ PASS' : '❌ FAIL'}`);
        if (token.solsniffer_score === 90) {
          console.log(`    ⚠️  Score of 90 is BLACKLISTED`);
        }
      }
      
      console.log();
    }
    
    // Summary statistics
    const stats = await db('tokens')
      .whereNotNull('solsniffer_score')
      .select(
        db.raw('COUNT(*) as total'),
        db.raw('AVG(solsniffer_score) as avg_score'),
        db.raw('MIN(solsniffer_score) as min_score'),
        db.raw('MAX(solsniffer_score) as max_score'),
        db.raw('COUNT(CASE WHEN solsniffer_score > 60 THEN 1 END) as above_60'),
        db.raw('COUNT(CASE WHEN solsniffer_score = 90 THEN 1 END) as score_90'),
        db.raw('COUNT(CASE WHEN security_data IS NOT NULL THEN 1 END) as with_details')
      )
      .first();
    
    console.log('='.repeat(60));
    console.log('\nSummary Statistics:');
    console.log(`  Total tokens with scores: ${stats.total}`);
    console.log(`  Average score: ${Math.round(stats.avg_score)}`);
    console.log(`  Score range: ${stats.min_score} - ${stats.max_score}`);
    console.log(`  Tokens with score > 60: ${stats.above_60} (${((stats.above_60 / stats.total) * 100).toFixed(1)}%)`);
    console.log(`  Tokens with score = 90: ${stats.score_90}`);
    console.log(`  Tokens with detailed data: ${stats.with_details}`);
    
  } catch (error) {
    console.error('Error viewing security data:', error);
  }
}

viewSecurityData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });