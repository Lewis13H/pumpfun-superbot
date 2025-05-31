import { db } from '../src/database/postgres';

async function checkTokenDetails() {
  try {
    console.log('=== Checking Token Storage Pipeline ===\n');
    
    // Get the most recent token
    const latestToken = await db('tokens')
      .orderBy('created_at', 'desc')
      .first();
    
    if (latestToken) {
      console.log('Latest token in database:');
      console.log(JSON.stringify(latestToken, null, 2));
    }
    
    // Check if pump_fun specific fields exist
    console.log('\nChecking pump_fun specific columns...');
    const columns = await db.raw(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' 
      AND column_name IN ('creator', 'bonding_curve', 'associated_bonding_curve', 'creator_vault')
    `);
    
    console.log('Pump.fun columns that exist:');
    columns.rows.forEach((col: any) => console.log(`  - ${col.column_name}`));
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

checkTokenDetails();
