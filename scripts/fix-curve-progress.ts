import { db } from '../src/database/postgres';

async function fixCurveProgressColumn() {
  try {
    console.log('Fixing curve_progress column precision...');
    
    // First, let's check current values
    const largeValues = await db('tokens')
      .where('curve_progress', '>', 1)
      .select('address', 'symbol', 'curve_progress');
    
    if (largeValues.length > 0) {
      console.log('Found tokens with curve_progress > 1:');
      largeValues.forEach(t => {
        console.log(`  ${t.symbol}: ${t.curve_progress}`);
      });
    }
    
    // Update the column to allow larger values
    await db.schema.alterTable('tokens', (table) => {
      table.decimal('curve_progress', 10, 4).alter();
    });
    
    console.log('✅ Column precision updated to DECIMAL(10,4)');
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

fixCurveProgressColumn();
