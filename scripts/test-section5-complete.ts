import { discoveryService } from '../src/discovery/discovery-service';
import { categoryManager } from '../src/category/category-manager';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function testSection5() {
  console.log('=== Section 5 Complete Test ===\n');
  
  try {
    // Test 1: Database Schema
    console.log('Test 1: Checking database schema...');
    const columns = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('price', 'current_price')
    `);
    
    console.log('Price columns found:', columns.rows.map(r => r.column_name));
    
    if (columns.rows.find(r => r.column_name === 'price')) {
      console.log('❌ Old "price" column still exists!');
    } else if (columns.rows.find(r => r.column_name === 'current_price')) {
      console.log('✅ Correct "current_price" column exists');
    }
    
    // Test 2: Discovery without filtering
    console.log('\nTest 2: Testing discovery saves ALL tokens...');
    const beforeCount = await db('tokens').count('* as count').first();
    console.log(`Tokens before: ${beforeCount?.count || 0}`);
    
    // Initialize discovery
    await discoveryService.initialize();
    await discoveryService.start();
    
    // Wait for discoveries
    console.log('Discovering tokens for 30 seconds...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    const afterCount = await db('tokens').count('* as count').first();
    const newTokens = (afterCount?.count || 0) - (beforeCount?.count || 0);
    console.log(`New tokens discovered: ${newTokens}`);
    
    // Test 3: Category assignment
    console.log('\nTest 3: Checking category assignments...');
    const categoryDist = await db('tokens')
      .select('category')
      .count('* as count')
      .where('discovered_at', '>', new Date(Date.now() - 60000))
      .groupBy('category')
      .orderBy('category');
    
    console.log('Category distribution:');
    categoryDist.forEach(cat => {
      console.log(`  ${cat.category}: ${cat.count}`);
    });
    
    // Test 4: State machines
    console.log('\nTest 4: Checking state machines...');
    const stats = categoryManager.getStats();
    console.log(`Active state machines: ${stats.activeMachines}`);
    
    // Test 5: Recent tokens with market data
    console.log('\nTest 5: Recent tokens with market data:');
    const recentTokens = await db('tokens')
      .where('discovered_at', '>', new Date(Date.now() - 60000))
      .orderBy('discovered_at', 'desc')
      .limit(5)
      .select('symbol', 'category', 'market_cap', 'current_price', 'liquidity');
    
    console.table(recentTokens);
    
    // Test 6: Check for errors
    console.log('\nTest 6: Checking for discovery errors...');
    const stats = discoveryService.getStats();
    console.log('Discovery stats:', stats.discovery);
    
    // Stop services
    await discoveryService.stop();
    
    console.log('\n✅ Section 5 tests complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  process.exit(0);
}

testSection5();
