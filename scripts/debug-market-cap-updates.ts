import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { getCategoryFromMarketCap } from '../src/config/category-utils';

async function debugMarketCapUpdates() {
  console.log('=== Debugging Market Cap Updates ===\n');
  
  // 1. Find tokens with suspicious transitions
  console.log('1. Finding suspicious transitions (market cap = 0 to AIM)...\n');
  
  const suspiciousTransitions = await db('category_transitions')
    .where('to_category', 'AIM')
    .where('market_cap_at_transition', 0)
    .select('token_address', 'from_category', 'created_at')
    .limit(5);
  
  for (const trans of suspiciousTransitions) {
    const token = await db('tokens')
      .where('address', trans.token_address)
      .first();
    
    console.log(`Token: ${token?.symbol || trans.token_address}`);
    console.log(`  Address: ${trans.token_address}`);
    console.log(`  Transition: ${trans.from_category} → AIM at ${trans.created_at}`);
    console.log(`  Current market cap: $${token?.market_cap || 0}`);
    console.log(`  Should be in: ${getCategoryFromMarketCap(Number(token?.market_cap || 0))}`);
    
    // Check scan logs around that time
    const scansAroundTime = await db('scan_logs')
      .where('token_address', trans.token_address)
      .where('created_at', '>=', new Date(new Date(trans.created_at).getTime() - 5 * 60 * 1000))
      .where('created_at', '<=', new Date(new Date(trans.created_at).getTime() + 5 * 60 * 1000))
      .select('scan_duration_ms', 'apis_called', 'created_at')
      .orderBy('created_at');
    
    console.log(`  Scans around transition time:`);
    if (scansAroundTime.length === 0) {
      console.log('    No scans found');
    } else {
      scansAroundTime.forEach(scan => {
        console.log(`    ${scan.created_at}: APIs ${scan.apis_called || 'none'}`);
      });
    }
    console.log('');
  }
  
  // 2. Test market cap update logic
  console.log('\n2. Testing market cap update on a sample token...\n');
  
  const sampleToken = await db('tokens')
    .where('category', 'LOW')
    .whereNotNull('market_cap')
    .where('market_cap', '>', 0)
    .first();
  
  if (sampleToken) {
    console.log(`Testing with ${sampleToken.symbol}:`);
    console.log(`  Current category: ${sampleToken.category}`);
    console.log(`  Current market cap: $${sampleToken.market_cap}`);
    
    // Create state machine if doesn't exist
    await categoryManager.createOrRestoreStateMachine(
      sampleToken.address,
      sampleToken.category
    );
    
    // Test various market cap updates
    console.log('\n  Testing market cap updates:');
    
    // Test 1: Update with current market cap (should stay in same category)
    console.log(`\n  Test 1: Update with current market cap ($${sampleToken.market_cap})`);
    await categoryManager.updateTokenMarketCap(sampleToken.address, Number(sampleToken.market_cap));
    let state = categoryManager.getTokenState(sampleToken.address);
    console.log(`    Result: ${state?.value}`);
    
    // Test 2: Update with 0 (should go to NEW)
    console.log('\n  Test 2: Update with $0');
    await categoryManager.updateTokenMarketCap(sampleToken.address, 0);
    state = categoryManager.getTokenState(sampleToken.address);
    console.log(`    Result: ${state?.value}`);
    
    // Test 3: Update with 40000 (should go to AIM)
    console.log('\n  Test 3: Update with $40000');
    await categoryManager.updateTokenMarketCap(sampleToken.address, 40000);
    state = categoryManager.getTokenState(sampleToken.address);
    console.log(`    Result: ${state?.value}`);
    
    // Check if any incorrect transitions were recorded
    const recentTransitions = await db('category_transitions')
      .where('token_address', sampleToken.address)
      .orderBy('created_at', 'desc')
      .limit(5);
    
    console.log('\n  Recent transitions for this token:');
    recentTransitions.forEach(t => {
      console.log(`    ${t.from_category} → ${t.to_category} at MC $${t.market_cap_at_transition}`);
    });
  }
  
  // 3. Check for pattern in API responses
  console.log('\n3. Checking API response patterns...\n');
  
  const nullMarketCapTokens = await db('tokens')
    .whereNull('market_cap')
    .orWhere('market_cap', 0)
    .select('category')
    .count('* as count')
    .groupBy('category');
  
  console.log('Tokens with null/0 market cap by category:');
  console.table(nullMarketCapTokens);
}

debugMarketCapUpdates()
  .then(() => process.exit(0))
  .catch(console.error);