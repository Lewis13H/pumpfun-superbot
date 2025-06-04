import { db } from '../src/database/postgres';
import { categoryManager } from '../src/category/category-manager';
import { getCategoryFromMarketCap } from '../src/config/category-utils';
import { logger } from '../src/utils/logger';

async function migrateToCategories() {
  console.log('=== Migration to Category System ===\n');
  
  try {
    // Step 1: Run database migration
    console.log('Step 1: Running database migration...');
    await db.migrate.latest();
    console.log('✅ Database schema updated');
    
    // Step 2: Categorize existing tokens
    console.log('\nStep 2: Categorizing existing tokens...');
    
    const tokens = await db('tokens')
      .whereNull('category')
      .orWhere('category', '')
      .select('address', 'symbol', 'market_cap', 'monitoring_priority');
    
    console.log(`Found ${tokens.length} tokens to migrate`);
    
    let categorized = 0;
    const batchSize = 100;
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (token) => {
        const marketCap = Number(token.market_cap) || 0;
        const category = getCategoryFromMarketCap(marketCap);
        
        await db('tokens')
          .where('address', token.address)
          .update({
            category,
            category_updated_at: new Date(),
            previous_category: null,
            category_scan_count: 0,
          });
        
        // High priority tokens likely should be in HIGH/AIM
        if (token.monitoring_priority === 'high' && marketCap > 20000) {
          await db('tokens')
            .where('address', token.address)
            .update({
              category: marketCap >= 35000 ? 'AIM' : 'HIGH',
            });
        }
      }));
      
      categorized += batch.length;
      console.log(`Categorized ${categorized}/${tokens.length} tokens`);
    }
    
    // Step 3: Create initial state machines
    console.log('\nStep 3: Creating state machines...');
    
    const activeTokens = await db('tokens')
      .whereNotIn('category', ['BIN', 'ARCHIVE'])
      .whereNotNull('category')
      .select('address', 'category', 'market_cap');
    
    console.log(`Creating state machines for ${activeTokens.length} active tokens`);
    
    let created = 0;
    for (const token of activeTokens) {
      await categoryManager.createOrRestoreStateMachine(
        token.address,
        token.category,
        {
          currentMarketCap: Number(token.market_cap) || 0,
          scanCount: 0,
        }
      );
      
      created++;
      if (created % 100 === 0) {
        console.log(`Created ${created}/${activeTokens.length} state machines`);
      }
    }
    
    // Step 4: Verify migration
    console.log('\nStep 4: Verifying migration...');
    
    const distribution = await db('tokens')
      .select('category')
      .count('* as count')
      .groupBy('category')
      .orderBy('category');
    
    console.log('\nCategory Distribution:');
    console.table(distribution);
    
    const uncategorized = await db('tokens')
      .whereNull('category')
      .count('* as count')
      .first();
    
    if (Number(uncategorized?.count) > 0) {
      console.log(`\n⚠️  Warning: ${uncategorized?.count} tokens still uncategorized`);
    } else {
      console.log('\n✅ All tokens categorized successfully');
    }
    
    // Step 5: Archive old tokens
    console.log('\nStep 5: Archiving old inactive tokens...');
    
    const oldTokens = await db('tokens')
      .where('category', 'LOW')
      .where('updated_at', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) // 7 days
      .update({
        category: 'ARCHIVE',
        category_updated_at: new Date(),
      });
    
    console.log(`Archived ${oldTokens} old tokens`);
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Add confirmation prompt
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question('This will migrate the database to the category system. Continue? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes') {
    migrateToCategories()
      .then(() => {
        readline.close();
        process.exit(0);
      })
      .catch(() => {
        readline.close();
        process.exit(1);
      });
  } else {
    console.log('Migration cancelled');
    readline.close();
    process.exit(0);
  }
});
