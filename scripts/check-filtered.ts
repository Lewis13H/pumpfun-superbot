import { db } from '../src/database/postgres';

async function checkFilteredTokens() {
  console.log('🔍 Checking Filtered Tokens...\n');
  
  try {
    // First, let's see if we're storing filter reasons
    const filtered = await db('filtered_tokens')
      .orderBy('filtered_at', 'desc')
      .limit(10);
    
    console.log('Recent filtered tokens:');
    filtered.forEach((t: any) => {
      console.log(`- ${t.token_address}: ${t.filter_reason || 'no reason stored'}`);
    });
    
    // Check if the filter_reason column exists
    const columns = await db('filtered_tokens').columnInfo();
    console.log('\nfiltered_tokens columns:', Object.keys(columns));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

checkFilteredTokens();
