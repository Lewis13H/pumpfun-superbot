const fs = require('fs');
const path = require('path');

// Read current package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Add the missing scripts
const newScripts = {
  "dev": "nodemon --exec ts-node src/index.ts",
  "build": "tsc",
  "start": "node dist/index.ts",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "lint": "eslint src/**/*.ts",
  "format": "prettier --write src/**/*.ts",
  "ts-node": "ts-node",
  "test:api": "ts-node scripts/test-api-integration.ts",
  "test:api:simple": "ts-node scripts/test-api-simple.ts",
  "test:discovery": "ts-node scripts/test-full-discovery.ts",
  "test:db": "ts-node scripts/test-db.ts",
  "test:analyze": "ts-node scripts/test-analyze-token.ts",
  "reanalyze": "ts-node scripts/reanalyze-tokens.ts",
  "cleanup": "ts-node scripts/cleanup-old-data.ts",
  "status": "ts-node scripts/check-token-status.ts"
};

// Update scripts
packageJson.scripts = newScripts;

// Write back to file
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

console.log('✅ Package.json updated with all scripts');
console.log('\nYou can now use:');
console.log('  npm run status      - Check token database status');
console.log('  npm run cleanup     - Clean up old data');
console.log('  npm run reanalyze   - Re-analyze tokens with API data');
console.log('  npm run test:analyze - Test token analysis');