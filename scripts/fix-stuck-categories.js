const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

async function fixStuckCategories() {
  console.log('Checking for stuck tokens...\n');
  
  // Define category thresholds
  const categories = [
    { name: 'AIM', min: 35000, max: 145000 },
    { name: 'HIGH', min: 19000, max: 35000 },
    { name: 'MEDIUM', min: 8000, max: 19000 },
    { name: 'LOW', min: 0, max: 8000 }
  ];
  
  for (const cat of categories) {
    // Find tokens that should be in this category
    const query = `
      SELECT address, symbol, category, market_cap 
      FROM tokens 
      WHERE market_cap >= $1 
        AND market_cap < $2 
        AND category != $3
        AND category NOT IN ('BIN', 'ARCHIVE')
      LIMIT 100
    `;
    
    const misplacedTokens = await pool.query(query, [cat.min, cat.max, cat.name]);
    
    if (misplacedTokens.rows.length > 0) {
      console.log(`Found ${misplacedTokens.rows.length} tokens that should be in ${cat.name}:`);
      
      for (const token of misplacedTokens.rows) {
        console.log(`  ${token.symbol}: $${token.market_cap} (currently ${token.category})`);
        
        // Update category
        await pool.query(
          `UPDATE tokens 
           SET category = $1, 
               category_updated_at = NOW(),
               category_scan_count = 0
           WHERE address = $2`,
          [cat.name, token.address]
        );
        
        // Add transition record
        await pool.query(
          `INSERT INTO category_transitions 
           (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [token.address, token.category, cat.name, token.market_cap, 'Manual fix - stuck category']
        );
      }
      
      console.log(`✓ Updated ${misplacedTokens.rows.length} tokens to ${cat.name}\n`);
    }
  }
  
  await pool.end();
}

fixStuckCategories().catch(console.error);