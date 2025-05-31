import { db } from '../src/database/postgres';

async function quickStatus() {
  try {
    const stats = await db.raw(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(CASE WHEN market_cap > 5000 THEN 1 END) as quality_tokens,
        COUNT(CASE WHEN market_cap > 20000 THEN 1 END) as established_tokens,
        COUNT(CASE WHEN market_cap > 50000 THEN 1 END) as near_graduation,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
      FROM tokens
    `);
    
    console.log('Token Statistics:');
    console.log(`  Total: ${stats.rows[0].total_tokens}`);
    console.log(`  Quality ($5K+): ${stats.rows[0].quality_tokens}`);
    console.log(`  Established ($20K+): ${stats.rows[0].established_tokens}`);
    console.log(`  Near Graduation ($50K+): ${stats.rows[0].near_graduation}`);
    console.log(`  Discovered Last Hour: ${stats.rows[0].last_hour}`);
    
    await db.destroy();
  } catch (error) {
    console.error('Error:', error);
    await db.destroy();
  }
}

quickStatus();
