// scripts/check-solsniffer-db.ts
import { db } from '../src/database/postgres';

async function checkSolSnifferSchema() {
  console.log('=== Checking SolSniffer Database Schema ===\n');
  
  try {
    // Check if columns exist
    const columns = await db('tokens').columnInfo();
    
    console.log('Token table columns related to SolSniffer:');
    console.log('  solsniffer_score:', columns.solsniffer_score ? '✅ EXISTS' : '❌ MISSING');
    console.log('  solsniffer_checked_at:', columns.solsniffer_checked_at ? '✅ EXISTS' : '❌ MISSING');
    console.log('  security_data:', columns.security_data ? '✅ EXISTS' : '❌ MISSING');
    
    // Check data types
    if (columns.solsniffer_score) {
      console.log(`\n  solsniffer_score type: ${columns.solsniffer_score.type}`);
    }
    
    // Check for tokens with SolSniffer scores
    const tokensWithScores = await db('tokens')
      .whereNotNull('solsniffer_score')
      .count('* as count')
      .first();
    
    console.log(`\nTokens with SolSniffer scores: ${tokensWithScores?.count || 0}`);
    
    // Check AIM tokens
    const aimTokens = await db('tokens')
      .where('category', 'AIM')
      .select('address', 'symbol', 'solsniffer_score', 'solsniffer_checked_at')
      .limit(10);
    
    if (aimTokens.length > 0) {
      console.log('\nAIM Tokens SolSniffer Status:');
      console.table(aimTokens.map(t => ({
        symbol: t.symbol,
        score: t.solsniffer_score || 'NOT SET',
        checked: t.solsniffer_checked_at ? new Date(t.solsniffer_checked_at).toLocaleString() : 'NEVER'
      })));
    }
    
    // Add missing columns if needed
    if (!columns.solsniffer_score || !columns.solsniffer_checked_at) {
      console.log('\n⚠️  Missing columns detected. Run this SQL to add them:\n');
      
      if (!columns.solsniffer_score) {
        console.log(`ALTER TABLE tokens ADD COLUMN solsniffer_score INTEGER;`);
      }
      if (!columns.solsniffer_checked_at) {
        console.log(`ALTER TABLE tokens ADD COLUMN solsniffer_checked_at TIMESTAMP;`);
      }
      if (!columns.security_data) {
        console.log(`ALTER TABLE tokens ADD COLUMN security_data JSONB;`);
      }
    }
    
  } catch (error) {
    console.error('Error checking schema:', error);
  }
}

checkSolSnifferSchema()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Check failed:', error);
    process.exit(1);
  });