// scripts/project-status-snapshot.ts
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';
import { execSync } from 'child_process';

async function generateProjectSnapshot(): Promise<void> {
  const output: string[] = [];
  const timestamp = new Date().toISOString();
  
  output.push('# Solana Token Discovery System - Project Status Snapshot');
  output.push(`Generated: ${timestamp}\n`);

  // 1. Project Overview
  output.push('## 1. Project Overview');
  output.push('- **Name**: Memecoin Discovery Scanner & Assessor Bot');
  output.push('- **Purpose**: Discover and analyze Solana tokens, with enhanced pump.fun integration');
  output.push('- **Current Status**: Module 2A (API Integration) with PumpFun IDL enhancement completed\n');

  // 2. System Information
  output.push('## 2. System Information');
  output.push('```');
  output.push(`OS: Windows`);
  output.push(`Node.js: ${process.version}`);
  output.push(`Working Directory: ${process.cwd()}`);
  output.push('```\n');

  // 3. Directory Structure
  output.push('## 3. Project Directory Structure');
  output.push('```');
  const dirTree = generateDirectoryTree('src', 2);
  output.push(dirTree);
  output.push('```\n');

  // 4. Key Files Status
  output.push('## 4. Key Files Status');
  const keyFiles = [
    'src/config/index.ts',
    'src/discovery/enhanced-pumpfun-monitor.ts',
    'src/discovery/pumpfun-monitor.ts',
    'src/api/pumpfun/curve-manager.ts',
    'src/api/pumpfun/event-processor.ts',
    'src/api/pumpfun/types.ts',
    'idl/pump_fun_idl.json',
    '.env'
  ];
  
  output.push('| File | Status | Size |');
  output.push('|------|--------|------|');
  keyFiles.forEach(file => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      output.push(`| ${file} | ✅ Exists | ${(stats.size / 1024).toFixed(1)} KB |`);
    } else {
      output.push(`| ${file} | ❌ Missing | - |`);
    }
  });
  output.push('');

  // 5. Database Schema
  output.push('## 5. Database Schema Status');
  
  try {
    // Check tables
    const tables = await db('information_schema.tables')
      .select('table_name')
      .where('table_schema', 'public')
      .andWhere('table_type', 'BASE TABLE')
      .orderBy('table_name');
    
    output.push('### Tables:');
    for (const table of tables) {
      const count = await db(table.table_name).count('* as count');
      output.push(`- **${table.table_name}**: ${count[0].count} rows`);
    }
    output.push('');
    
    // Check pump.fun specific columns in tokens table
    const tokenColumns = await db('tokens').columnInfo();
    const pumpfunColumns = [
      'bonding_curve', 'associated_bonding_curve', 'creator', 'creator_vault',
      'initial_price_sol', 'initial_liquidity_sol', 'curve_progress', 'is_pump_fun'
    ];
    
    output.push('### PumpFun Columns in tokens table:');
    pumpfunColumns.forEach(col => {
      if (tokenColumns[col]) {
        output.push(`- ✅ ${col}: ${tokenColumns[col].type}`);
      } else {
        output.push(`- ❌ ${col}: Missing`);
      }
    });
    output.push('');
    
  } catch (error) {
    output.push('❌ Database connection error\n');
  }

  // 6. Environment Configuration
  output.push('## 6. Environment Configuration');
  output.push('```env');
  output.push('# Required environment variables (values hidden):');
  const envVars = [
    'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_DB',
    'QUESTDB_HOST', 'HELIUS_RPC_URL', 
    'SOLSNIFFER_API_KEY', 'BIRDEYE_API_KEY', 'MORALIS_API_KEY'
  ];
  envVars.forEach(varName => {
    const exists = process.env[varName] ? '✅ Set' : '❌ Not Set';
    output.push(`${varName}=${exists}`);
  });
  output.push('```\n');

  // 7. Dependencies
  output.push('## 7. Key Dependencies');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const keyDeps = [
    '@solana/web3.js', '@project-serum/borsh', 'bs58', 
    'knex', 'pg', 'axios', 'ws', 'p-queue'
  ];
  output.push('```json');
  keyDeps.forEach(dep => {
    if (packageJson.dependencies[dep]) {
      output.push(`"${dep}": "${packageJson.dependencies[dep]}"`);
    }
  });
  output.push('```\n');

  // 8. Current Issues/Errors
  output.push('## 8. Current Status & Known Issues');
  output.push('### Working:');
  output.push('- ✅ Database migration completed with pump.fun tables');
  output.push('- ✅ API server running');
  output.push('- ✅ WebSocket connection to PumpFun established');
  output.push('- ✅ Token discovery system active');
  output.push('');
  output.push('### Issues:');
  output.push('- ⚠️ Event processor having trouble parsing pump.fun logs (offset out of range)');
  output.push('- ⚠️ Need to verify pump.fun IDL format matches actual log data');
  output.push('');

  // 9. Module Progress
  output.push('## 9. Module Implementation Progress');
  output.push('### Phase 1: Core Foundation ✅');
  output.push('- Module 1A: Database & Config Foundation ✅');
  output.push('- Module 1B: Basic Discovery Framework ✅');
  output.push('- Module 1C: Simple Analysis Pipeline ✅');
  output.push('');
  output.push('### Phase 2: Intelligence Layer (In Progress)');
  output.push('- Module 2A: API Integration Framework ✅ (Enhanced with PumpFun IDL)');
  output.push('- Module 2B: Token Analysis Engine ⏳');
  output.push('- Module 2C: Holder Analysis System ⏳');
  output.push('- Module 2D: ML Scoring Foundation ⏳');
  output.push('');

  // 10. Recent Commands
  output.push('## 10. Setup Commands for Fresh Installation');
  output.push('```bash');
  output.push('# Install dependencies');
  output.push('npm install');
  output.push('');
  output.push('# Database setup');
  output.push('npm run db:setup');
  output.push('npm run db:migrate:pumpfun');
  output.push('npm run db:verify:pumpfun');
  output.push('');
  output.push('# Run the system');
  output.push('npm run dev');
  output.push('```\n');

  // 11. File Changes Made
  output.push('## 11. Recent File Modifications');
  output.push('### Modified Files:');
  output.push('- `src/discovery/pumpfun-monitor.ts` - Now contains EnhancedPumpFunMonitor');
  output.push('- `src/discovery/discovery-service.ts` - Import alias for PumpFunMonitor');
  output.push('- `src/api/routes/index.ts` - Fixed import paths');
  output.push('- `src/api/server.ts` - Exports app directly');
  output.push('- `src/api/pumpfun/curve-manager.ts` - Fixed totalSupply reference');
  output.push('- `src/api/pumpfun/event-processor.ts` - Fixed bs58 import');
  output.push('');

  // Save to file
  const outputPath = path.join(process.cwd(), `project-snapshot-${Date.now()}.md`);
  fs.writeFileSync(outputPath, output.join('\n'));
  
  console.log(`\n✅ Project snapshot saved to: ${outputPath}`);
  console.log('\nYou can share this file to continue work in another session.');
  
  // Also output to console for immediate copying
  console.log('\n' + '='.repeat(80));
  console.log(output.join('\n'));
  
  await db.destroy();
}

function generateDirectoryTree(dir: string, maxDepth: number, currentDepth: number = 0, prefix: string = ''): string {
  if (currentDepth > maxDepth) return '';
  
  const items = fs.readdirSync(dir);
  let tree = '';
  
  items.forEach((item, index) => {
    const itemPath = path.join(dir, item);
    const isLast = index === items.length - 1;
    const stats = fs.statSync(itemPath);
    
    if (item === 'node_modules' || item === '.git' || item === 'dist') return;
    
    tree += prefix + (isLast ? '└── ' : '├── ') + item + '\n';
    
    if (stats.isDirectory() && currentDepth < maxDepth) {
      const extension = isLast ? '    ' : '│   ';
      tree += generateDirectoryTree(itemPath, maxDepth, currentDepth + 1, prefix + extension);
    }
  });
  
  return tree;
}

if (require.main === module) {
  generateProjectSnapshot().catch(console.error);
}