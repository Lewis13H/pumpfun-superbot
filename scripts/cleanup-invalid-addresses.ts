// scripts/cleanup-invalid-addresses.ts
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';
import { AddressValidator } from '../src/utils/address-validator';

async function cleanupInvalidAddresses() {
  logger.info('🧹 Starting cleanup of invalid addresses...');

  try {
    // Get all tokens
    const tokens = await db('tokens')
      .select('address', 'symbol', 'platform')
      .orderBy('discovered_at', 'desc');

    logger.info(`Found ${tokens.length} total tokens in database`);

    // Validate addresses
    const addresses = tokens.map(t => t.address);
    const validation = AddressValidator.validateBatch(addresses);

    logger.info(`✅ Valid addresses: ${validation.valid.length}`);
    logger.info(`❌ Invalid addresses: ${validation.invalid.length}`);

    if (validation.invalid.length > 0) {
      logger.info('\nInvalid addresses found:');
      validation.invalid.slice(0, 10).forEach(({ address, reason }) => {
        const token = tokens.find(t => t.address === address);
        logger.info(`  ${token?.symbol} (${token?.platform}): ${address}`);
        logger.info(`    Reason: ${reason}`);
      });

      // Ask for confirmation
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        readline.question(`\nDo you want to delete ${validation.invalid.length} invalid tokens? (yes/no): `, resolve);
      });

      if (answer.toLowerCase() === 'yes') {
        // Delete invalid tokens - need to handle foreign key constraints
        const invalidAddresses = validation.invalid.map(i => i.address);
        
        // Start a transaction
        const trx = await db.transaction();
        
        try {
          // First, delete related analysis history
          const historyDeleted = await trx('token_analysis_history')
            .whereIn('token_address', invalidAddresses)
            .delete();
          
          logger.info(`Deleted ${historyDeleted} analysis history records`);
          
          // Then delete the tokens
          const tokensDeleted = await trx('tokens')
            .whereIn('address', invalidAddresses)
            .delete();
          
          // Commit the transaction
          await trx.commit();
          
          logger.info(`✅ Deleted ${tokensDeleted} tokens with invalid addresses`);
        } catch (error) {
          await trx.rollback();
          throw error;
        }
      } else {
        logger.info('❌ Cleanup cancelled');
      }

      readline.close();
    } else {
      logger.info('✅ No invalid addresses found!');
    }

  } catch (error) {
    logger.error('Cleanup failed:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

// Run cleanup
cleanupInvalidAddresses();