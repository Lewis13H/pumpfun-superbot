// scripts/test-address-validation.ts
import { AddressValidator } from '../src/utils/address-validator';
import { logger } from '../src/utils/logger';

function testAddressValidation() {
  logger.info('🧪 Testing Address Validation\n');

  // Test cases
  const testCases = [
    // Valid Solana addresses
    { address: 'So11111111111111111111111111111111111111112', expected: true, description: 'Valid SOL address' },
    { address: '2wE8YGFt9B8of3Lg3374dsuQhwpvkNmz5BzEVc78iGax', expected: true, description: 'Valid token address' },
    
    // Invalid addresses from your discovery
    { address: 'qBgytv1YCZNyGHdGjYU1qSQt4UpJq4z4G2Hbhn4DkMW1', expected: false, description: 'Contains invalid character "q"' },
    { address: 'v35wp6eyQP5Gv1BBHnG9ExhEXS8ycymKkDEjaov4YW9k', expected: false, description: 'Contains invalid character "v"' },
    
    // Edge cases
    { address: '', expected: false, description: 'Empty string' },
    { address: null, expected: false, description: 'Null value' },
    { address: 'abc123', expected: false, description: 'Too short' },
    { address: '0000000000000000000000000000000000000000000', expected: false, description: 'Contains "0" (invalid in base58)' },
    { address: 'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII', expected: false, description: 'Contains "I" (invalid in base58)' },
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach(({ address, expected, description }) => {
    const result = AddressValidator.isValidAddress(address as any);
    const status = result === expected ? '✅' : '❌';
    
    if (result === expected) {
      passed++;
    } else {
      failed++;
    }

    logger.info(`${status} ${description}`);
    logger.info(`   Address: ${address}`);
    logger.info(`   Expected: ${expected}, Got: ${result}\n`);
  });

  logger.info(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

  // Test sanitization
  logger.info('\n🧹 Testing Token Sanitization:\n');

  const testTokens = [
    {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      platform: 'test'
    },
    {
      address: 'qBgytv1YCZNyGHdGjYU1qSQt4UpJq4z4G2Hbhn4DkMW1',
      symbol: 'INVALID',
      name: 'Invalid Token',
      platform: 'test'
    },
    {
      address: '2wE8YGFt9B8of3Lg3374dsuQhwpvkNmz5BzEVc78iGax',
      symbol: 'TEST\x00\x01\x02', // Contains control characters
      name: 'Test Token with Bad Chars',
      platform: 'test'
    }
  ];

  testTokens.forEach(token => {
    const sanitized = AddressValidator.sanitizeTokenData(token);
    
    if (sanitized) {
      logger.info(`✅ Token sanitized: ${sanitized.symbol} (${sanitized.address})`);
    } else {
      logger.info(`❌ Token rejected: ${token.symbol} (${token.address})`);
    }
  });
}

// Run tests
testAddressValidation();
process.exit(0);