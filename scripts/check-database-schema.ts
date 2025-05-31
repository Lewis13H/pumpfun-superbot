import { db } from '../src/database/postgres';

async function checkDatabaseSchema() {
  console.log('🔍 Checking Database Schema:\n');
  
  try {
    // Check filtered_tokens structure
    const filteredColumns = await db('filtered_tokens').columnInfo();
    console.log('filtered_tokens columns:', Object.keys(filteredColumns));
    
    // Check tokens table structure
    const tokenColumns = await db('tokens').columnInfo();
    console.log('\ntokens columns:', Object.keys(tokenColumns).slice(0, 10), '...');
    
    // Get some sample data from filtered_tokens
    const sampleFiltered = await db('filtered_tokens')
      .limit(5)
      .select('*');
    console.log('\n📊 Sample filtered tokens:');
    console.log(sampleFiltered);
    
    // Check token count
    const tokenCount = await db('tokens').count('* as total');
    console.log('\n✅ Total tokens in database:', tokenCount[0].total);
    
    // Check if discovery_settings has any data
    const settings = await db('discovery_settings').select('*');
    console.log('\n⚙️ Discovery settings:', settings);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.destroy();
  }
}

checkDatabaseSchema();
