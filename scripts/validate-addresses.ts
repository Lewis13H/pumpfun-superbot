import { PublicKey } from '@solana/web3.js';
import { db } from '../src/database/postgres';

async function validateAddresses() {
  console.log('\n🔍 Validating Token Addresses\n');

  // Get a sample of tokens
  const tokens = await db('tokens')
    .select('address', 'symbol', 'platform', 'created_at')
    .orderBy('discovered_at', 'desc')
    .limit(50);

  let validCount = 0;
  let invalidCount = 0;
  const invalidTokens = [];

  console.log(`Checking ${tokens.length} token addresses...\n`);

  for (const token of tokens) {
    try {
      // Try to create a PublicKey from the address
      new PublicKey(token.address);
      validCount++;
    } catch (error) {
      invalidCount++;
      invalidTokens.push(token);
    }
  }

  console.log(`✅ Valid addresses: ${validCount}`);
  console.log(`❌ Invalid addresses: ${invalidCount}\n`);

  if (invalidTokens.length > 0) {
    console.log('Examples of invalid addresses:');
    for (const token of invalidTokens.slice(0, 10)) {
      console.log(`  ${token.symbol || 'Unknown'} (${token.platform}): ${token.address}`);
      console.log(`    Length: ${token.address.length} characters`);
    }
  }

  // Check address patterns
  console.log('\n📊 Address Analysis:');
  
  // Group by platform
  const platformStats = await db('tokens')
    .select('platform')
    .select(db.raw('COUNT(*) as count'))
    .select(db.raw('AVG(LENGTH(address)) as avg_length'))
    .groupBy('platform');

  for (const stat of platformStats) {
    console.log(`\n${stat.platform}:`);
    console.log(`  Total tokens: ${stat.count}`);
    console.log(`  Average address length: ${Math.round(stat.avg_length)} characters`);
  }

  // Check specific problematic addresses
  const problematicTokens = await db('tokens')
    .select('address', 'symbol', 'platform')
    .whereIn('address', [
      '2wE8YGFt9B8of3Lg3374dsuQhwpvkNmz5BzEVc78iGax',
      'qBgytv1YCZNyGHdGjYU1qSQt4UpJq4z4G2Hbhn4DkMW1',
      'v35wp6eyQP5Gv1BBHnG9ExhEXS8ycymKkDEjaov4YW9k'
    ]);

  console.log('\n🔍 Checking specific addresses that failed:');
  for (const token of problematicTokens) {
    console.log(`\n${token.symbol} (${token.platform}):`);
    console.log(`  Address: ${token.address}`);
    console.log(`  Length: ${token.address.length}`);
    
    try {
      const pubkey = new PublicKey(token.address);
      console.log(`  ✅ Valid Solana address`);
      console.log(`  Base58: ${pubkey.toBase58()}`);
    } catch (error: any) {
      console.log(`  ❌ Invalid: ${error.message}`);
    }
  }

  console.log('\n✅ Validation complete!\n');
}

validateAddresses()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Validation failed:', error);
    process.exit(1);
  });