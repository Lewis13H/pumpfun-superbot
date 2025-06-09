// step3-graduation-fixes.ts
// Fixed version with proper token mapping and database handling

import "dotenv/config";
import Client, {
  CommitmentLevel,
  SubscribeRequestAccountsDataSlice,
  SubscribeRequestFilterAccounts,
  SubscribeRequestFilterBlocks,
  SubscribeRequestFilterBlocksMeta,
  SubscribeRequestFilterEntry,
  SubscribeRequestFilterSlots,
  SubscribeRequestFilterTransactions,
} from "@triton-one/yellowstone-grpc";
import { SubscribeRequestPing } from "@triton-one/yellowstone-grpc/dist/grpc/geyser";
import { struct, bool, u64, publicKey } from "@coral-xyz/borsh";
import base58 from "bs58";
import { EventEmitter } from 'events';

// Enhanced bonding curve structure with token mint
export const bondingCurveStructure = struct([
  u64("discriminator"),
  u64("virtualTokenReserves"),
  u64("virtualSolReserves"),
  u64("realTokenReserves"),
  u64("realSolReserves"),
  u64("tokenTotalSupply"),
  bool("complete"),
  publicKey("tokenMint"), // This is the actual token address!
]);

// Constants
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const MIGRATION_PROGRAM = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
const GRADUATION_TARGET = 85 * 1e9;
const SOL_PRICE_USD = 180;

// Database setup
const { Client: PgClient } = require('pg');
function createDbConfig() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    database: process.env.POSTGRES_DB || 'memecoin_discovery',
    user: process.env.POSTGRES_USER || 'memecoin_user',
    password: process.env.POSTGRES_PASSWORD || '',
  };
}

interface SubscribeRequest {
  accounts: { [key: string]: SubscribeRequestFilterAccounts };
  slots: { [key: string]: SubscribeRequestFilterSlots };
  transactions: { [key: string]: SubscribeRequestFilterTransactions };
  transactionsStatus: { [key: string]: SubscribeRequestFilterTransactions };
  blocks: { [key: string]: SubscribeRequestFilterBlocks };
  blocksMeta: { [key: string]: SubscribeRequestFilterBlocksMeta };
  entry: { [key: string]: SubscribeRequestFilterEntry };
  commitment?: CommitmentLevel | undefined;
  accountsDataSlice: SubscribeRequestAccountsDataSlice[];
  ping?: SubscribeRequestPing | undefined;
}

class FixedGraduationDetector extends EventEmitter {
  private progressionClient: any;
  private migrationClient: any;
  private progressionStream: any;
  private migrationStream: any;
  private dbClient: any;
  private isConnected = false;
  
  private stats = {
    totalUpdates: 0,
    graduations: 0,
    migrations: 0,
    nearGraduations: 0,
    errors: 0,
    duplicatePrevented: 0,
    startTime: new Date()
  };

  // Better duplicate prevention
  private knownGraduations = new Set<string>();
  private graduationCooldown = new Map<string, number>(); // Prevent rapid-fire duplicates
  private lastProgressSeen = new Map<string, number>();

  // Token mapping
  private bondingCurveToToken = new Map<string, string>();
  private tokenToBondingCurve = new Map<string, string>();

  constructor() {
    super();
    console.log('🎓 Fixed Graduation Detector V4.25 Initialized');
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Fixed Graduation & Migration Detection...\n');

      await this.initializeDatabase();
      await this.loadExistingData();
      await Promise.all([
        this.startProgressionMonitoring(),
        this.startMigrationMonitoring()
      ]);

    } catch (error) {
      console.error('❌ Failed to start detector:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  private async initializeDatabase(): Promise<void> {
    console.log('📂 Connecting to database...');
    this.dbClient = new PgClient(createDbConfig());
    await this.dbClient.connect();
    console.log('   ✅ Database connected');

    // Create a more flexible graduation table without foreign key constraints
    await this.createFlexibleGraduationTable();
  }

  private async createFlexibleGraduationTable(): Promise<void> {
    try {
      // Create graduation table without foreign key if it doesn't exist
      await this.dbClient.query(`
        CREATE TABLE IF NOT EXISTS public.pump_graduations (
          id SERIAL PRIMARY KEY,
          token_address VARCHAR(44) NOT NULL,
          bonding_curve_address VARCHAR(44),
          graduated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          final_market_cap DECIMAL(30,2),
          final_price_usd NUMERIC(40,20),
          final_price_sol NUMERIC(40,20),
          total_sol_raised DECIMAL(20,9),
          progress_from_last_seen DECIMAL(5,2),
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(token_address) -- Prevent duplicates
        )
      `);

      // Create migrations table
      await this.dbClient.query(`
        CREATE TABLE IF NOT EXISTS public.pump_migrations (
          id SERIAL PRIMARY KEY,
          token_address VARCHAR(44),
          migration_signature VARCHAR(88) UNIQUE,
          migrated_at TIMESTAMP DEFAULT NOW(),
          raydium_pool_address VARCHAR(44),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      console.log('   ✅ Flexible graduation tables ready');

    } catch (error) {
      console.log('   ⚠️ Could not create graduation tables:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async loadExistingData(): Promise<void> {
    try {
      // Load existing graduations from our flexible table
      const graduationsResult = await this.dbClient.query('SELECT token_address FROM pump_graduations');
      graduationsResult.rows.forEach((row: any) => {
        this.knownGraduations.add(row.token_address);
      });

      // Load token-curve mappings from main tokens table
      const mappingsResult = await this.dbClient.query(`
        SELECT address, bonding_curve 
        FROM tokens 
        WHERE bonding_curve IS NOT NULL
      `);

      mappingsResult.rows.forEach((row: any) => {
        if (row.bonding_curve) {
          this.bondingCurveToToken.set(row.bonding_curve, row.address);
          this.tokenToBondingCurve.set(row.address, row.bonding_curve);
        }
      });

      console.log(`   📋 Loaded ${graduationsResult.rows.length} graduations, ${mappingsResult.rows.length} token mappings`);

    } catch (error) {
      console.log('   ⚠️ Could not load existing data:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async startProgressionMonitoring(): Promise<void> {
    console.log('👀 Starting progression monitoring stream...');

    const grpcUrl = process.env.GRPC_ENDPOINT;
    const grpcToken = process.env.GRPC_TOKEN;
    
    if (!grpcUrl || !grpcToken) {
      throw new Error('Missing gRPC configuration');
    }

    this.progressionClient = new Client(grpcUrl, grpcToken, undefined);

    const progressionRequest: SubscribeRequest = {
      slots: {},
      accounts: {
        allBondingCurves: {
          account: [],
          filters: [],
          owner: [PUMP_FUN_PROGRAM]
        }
      },
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED,
      entry: {},
      transactionsStatus: {}
    };

    this.handleProgressionStream(progressionRequest);
  }

  private async startMigrationMonitoring(): Promise<void> {
    console.log('🚀 Starting migration monitoring stream...');

    this.migrationClient = new Client(process.env.GRPC_ENDPOINT!, process.env.GRPC_TOKEN!, undefined);

    const migrationRequest: SubscribeRequest = {
      slots: {},
      accounts: {},
      transactions: {
        migration: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [MIGRATION_PROGRAM],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED
    };

    this.handleMigrationStream(migrationRequest);
  }

  private async handleProgressionStream(request: SubscribeRequest): Promise<void> {
    while (true) {
      try {
        this.progressionStream = await this.progressionClient.subscribe();
        console.log('   🔄 Progression stream connected');

        const streamClosed = new Promise<void>((resolve, reject) => {
          this.progressionStream.on("error", (error: any) => {
            console.log("❌ Progression stream error:", error);
            reject(error);
            this.progressionStream.end();
          });
          this.progressionStream.on("end", resolve);
          this.progressionStream.on("close", resolve);
        });

        this.progressionStream.on("data", async (data: any) => {
          try {
            await this.handleBondingCurveUpdate(data);
          } catch (error) {
            this.stats.errors++;
            // Only log parsing errors occasionally
            if (this.stats.errors % 100 === 0) {
              console.error(`Error processing curve update (${this.stats.errors} total errors)`);
            }
          }
        });

        await new Promise<void>((resolve, reject) => {
          this.progressionStream.write(request, (err: any) => {
            err ? reject(err) : resolve();
          });
        });

        this.isConnected = true;
        this.startStatusReporting();

        await streamClosed;

      } catch (error) {
        console.error("Progression stream error, restarting...");
        this.isConnected = false;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  private async handleMigrationStream(request: SubscribeRequest): Promise<void> {
    while (true) {
      try {
        this.migrationStream = await this.migrationClient.subscribe();
        console.log('   🚀 Migration stream connected');

        const streamClosed = new Promise<void>((resolve, reject) => {
          this.migrationStream.on("error", (error: any) => {
            console.log("❌ Migration stream error:", error);
            reject(error);
            this.migrationStream.end();
          });
          this.migrationStream.on("end", resolve);
          this.migrationStream.on("close", resolve);
        });

        this.migrationStream.on("data", async (data: any) => {
          try {
            await this.handleMigrationTransaction(data);
          } catch (error) {
            console.error('Error processing migration:', error instanceof Error ? error.message : 'Unknown error');
          }
        });

        await new Promise<void>((resolve, reject) => {
          this.migrationStream.write(request, (err: any) => {
            err ? reject(err) : resolve();
          });
        });

        await streamClosed;

      } catch (error) {
        console.error("Migration stream error, restarting...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  private async handleBondingCurveUpdate(data: any): Promise<void> {
    if (!data.account?.account) return;

    const accountData = data.account.account;
    const bondingCurveAddress = base58.encode(Buffer.from(accountData.pubkey, 'base64'));
    const ownerAddress = base58.encode(Buffer.from(accountData.owner, 'base64'));

    if (ownerAddress !== PUMP_FUN_PROGRAM) return;

    try {
      const buffer = Buffer.from(accountData.data, 'base64');
      
      let bondingCurve;
      try {
        bondingCurve = bondingCurveStructure.decode(buffer);
      } catch (parseError) {
        // Try parsing without the tokenMint field for backwards compatibility
        try {
          const simpleBondingCurveStructure = struct([
            u64("discriminator"),
            u64("virtualTokenReserves"),
            u64("virtualSolReserves"),
            u64("realTokenReserves"),
            u64("realSolReserves"),
            u64("tokenTotalSupply"),
            bool("complete"),
          ]);
          bondingCurve = simpleBondingCurveStructure.decode(buffer);
          // Set a placeholder tokenMint
          bondingCurve.tokenMint = bondingCurveAddress;
        } catch (secondParseError) {
          return; // Skip invalid data
        }
      }

      const progression = this.calculateProgression(bondingCurve, bondingCurveAddress);
      this.stats.totalUpdates++;

      // Enhanced duplicate prevention
      if (this.isDuplicateGraduation(progression.tokenAddress, bondingCurve.complete)) {
        this.stats.duplicatePrevented++;
        return;
      }

      const lastProgress = this.lastProgressSeen.get(bondingCurveAddress) || 0;
      this.lastProgressSeen.set(bondingCurveAddress, progression.curveProgress);

      // Update token mapping
      if (bondingCurve.tokenMint && bondingCurve.tokenMint !== bondingCurveAddress) {
        this.bondingCurveToToken.set(bondingCurveAddress, bondingCurve.tokenMint.toString());
        this.tokenToBondingCurve.set(bondingCurve.tokenMint.toString(), bondingCurveAddress);
      }

      // 🎉 GRADUATION DETECTION with enhanced validation
      if (bondingCurve.complete && this.isValidGraduation(progression)) {
        await this.handleGraduationEvent(progression, lastProgress);
      }
      // Near graduation alerts
      else if (progression.curveProgress > 80 && !bondingCurve.complete) {
        this.handleNearGraduationEvent(progression);
      }
      // Regular progress updates
      else if (progression.curveProgress > 50) {
        console.log(`📈 Progress: ${progression.curveProgress.toFixed(1)}% | MC: $${progression.marketCap.toLocaleString()}`);
      }

    } catch (error) {
      this.stats.errors++;
    }
  }

  private isDuplicateGraduation(tokenAddress: string, isComplete: boolean): boolean {
    if (!isComplete) return false;

    // Check if already known
    if (this.knownGraduations.has(tokenAddress)) {
      return true;
    }

    // Check cooldown (prevent rapid-fire graduations)
    const now = Date.now();
    const lastGraduation = this.graduationCooldown.get(tokenAddress);
    if (lastGraduation && (now - lastGraduation) < 30000) { // 30 second cooldown
      return true;
    }

    return false;
  }

  private isValidGraduation(progression: any): boolean {
    // Validate graduation data
    if (progression.curveProgress < 95) return false; // Must be very close to 100%
    if (progression.marketCap <= 0) return false; // Must have positive market cap
    if (progression.solInCurve < 80) return false; // Must have raised significant SOL
    
    return true;
  }

  private calculateProgression(bondingCurve: any, bondingCurveAddress: string) {
    const realSolReserves = Number(bondingCurve.realSolReserves);
    const curveProgress = Math.min((realSolReserves / GRADUATION_TARGET) * 100, 100);

    const virtualSolReserves = Number(bondingCurve.virtualSolReserves);
    const virtualTokenReserves = Number(bondingCurve.virtualTokenReserves);
    
    const solReserves = virtualSolReserves / 1e9;
    const tokenReserves = virtualTokenReserves / 1e6;
    const priceSol = tokenReserves > 0 ? solReserves / tokenReserves : 0;
    const priceUsd = priceSol * SOL_PRICE_USD;

    const totalSupply = Number(bondingCurve.tokenTotalSupply) / 1e6;
    const marketCap = priceUsd * totalSupply;

    const solInCurve = realSolReserves / 1e9;
    const solNeeded = Math.max(0, (GRADUATION_TARGET - realSolReserves) / 1e9);

    // Use actual token mint if available, otherwise use mapped token or bonding curve
    let tokenAddress = bondingCurveAddress;
    if (bondingCurve.tokenMint && bondingCurve.tokenMint.toString() !== bondingCurveAddress) {
      tokenAddress = bondingCurve.tokenMint.toString();
    } else if (this.bondingCurveToToken.has(bondingCurveAddress)) {
      tokenAddress = this.bondingCurveToToken.get(bondingCurveAddress)!;
    }

    return {
      tokenAddress,
      bondingCurveAddress,
      curveProgress,
      priceSol,
      priceUsd,
      marketCap,
      solInCurve,
      solNeeded,
      isComplete: bondingCurve.complete,
      timestamp: new Date()
    };
  }

  private async handleGraduationEvent(progression: any, lastProgress: number): Promise<void> {
    this.stats.graduations++;
    this.knownGraduations.add(progression.tokenAddress);
    this.graduationCooldown.set(progression.tokenAddress, Date.now());

    const progressJump = progression.curveProgress - lastProgress;

    console.log('\n' + '🎉'.repeat(25));
    console.log('🎓 GRADUATION COMPLETED! 🎉');
    console.log('🎉'.repeat(25));
    console.log(`   🏆 Token: ${progression.tokenAddress.substring(0, 12)}...`);
    console.log(`   📊 Progress: ${lastProgress.toFixed(1)}% → 100.0% (+${progressJump.toFixed(1)}%)`);
    console.log(`   💰 Final Market Cap: $${progression.marketCap.toLocaleString()}`);
    console.log(`   🏦 Total SOL Raised: ${progression.solInCurve.toFixed(2)} SOL`);
    console.log(`   💵 Final Price: $${progression.priceUsd.toFixed(8)} (${progression.priceSol.toFixed(12)} SOL)`);
    console.log(`   ⏰ Graduation Time: ${new Date().toLocaleString()}`);
    console.log(`   🚀 Ready for Raydium migration!`);
    console.log('🎉'.repeat(25) + '\n');

    // Record in flexible database table
    await this.recordGraduation(progression, progressJump);

    this.emit('tokenGraduated', {
      tokenAddress: progression.tokenAddress,
      bondingCurveAddress: progression.bondingCurveAddress,
      finalMarketCap: progression.marketCap,
      totalSolRaised: progression.solInCurve,
      finalPrice: { usd: progression.priceUsd, sol: progression.priceSol },
      graduationTime: new Date(),
      progressFromLastSeen: progressJump
    });
  }

  private handleNearGraduationEvent(progression: any): void {
    if (progression.curveProgress > 95) {
      console.log(`🔥 VERY CLOSE: ${progression.curveProgress.toFixed(1)}% - Need ${progression.solNeeded.toFixed(2)} SOL`);
      this.stats.nearGraduations++;
    } else if (progression.curveProgress > 90) {
      console.log(`⚡ NEAR GRADUATION: ${progression.curveProgress.toFixed(1)}%`);
    }

    this.emit('nearGraduation', progression);
  }

  private async handleMigrationTransaction(data: any): Promise<void> {
    if (!data?.transaction?.transaction) return;

    try {
      const dataTx = data.transaction.transaction;
      const signature = base58.encode(Buffer.from(dataTx.signature, 'base64'));
      const meta = dataTx.meta;
      const logMessages = meta?.logMessages || [];

      if (logMessages.some((log: string) => log.includes('initialize2'))) {
        this.stats.migrations++;

        console.log('\n' + '🚀'.repeat(25));
        console.log('🌊 RAYDIUM MIGRATION DETECTED! 🚀');
        console.log('🚀'.repeat(25));
        console.log(`   📝 Transaction: ${signature}`);
        console.log(`   ⏰ Migration Time: ${new Date().toLocaleString()}`);
        console.log(`   🏦 Status: Token successfully migrated to Raydium DEX`);
        console.log(`   💱 Trading: Now available on Raydium for full market access`);
        console.log('🚀'.repeat(25) + '\n');

        await this.recordMigration(signature);

        this.emit('tokenMigrated', {
          migrationSignature: signature,
          migrationTime: new Date()
        });
      }

    } catch (error) {
      console.error('Error processing migration transaction:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async recordGraduation(progression: any, progressJump: number): Promise<void> {
    try {
      await this.dbClient.query(`
        INSERT INTO pump_graduations (
          token_address,
          bonding_curve_address,
          graduated_at,
          final_market_cap,
          final_price_usd,
          final_price_sol,
          total_sol_raised,
          progress_from_last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (token_address) DO NOTHING
      `, [
        progression.tokenAddress,
        progression.bondingCurveAddress,
        progression.timestamp,
        progression.marketCap,
        progression.priceUsd,
        progression.priceSol,
        progression.solInCurve,
        progressJump
      ]);

      console.log('✅ Graduation recorded in database');

    } catch (error) {
      console.error('❌ Error recording graduation:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async recordMigration(signature: string): Promise<void> {
    try {
      await this.dbClient.query(`
        INSERT INTO pump_migrations (migration_signature, migrated_at)
        VALUES ($1, $2)
        ON CONFLICT (migration_signature) DO NOTHING
      `, [signature, new Date()]);

      console.log('✅ Migration recorded in database');

    } catch (error) {
      console.error('❌ Error recording migration:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private startStatusReporting(): void {
    setInterval(() => {
      const uptime = Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000);
      console.log(`📊 Status: ${this.stats.totalUpdates} updates | 🎓 ${this.stats.graduations} graduations | 🚀 ${this.stats.migrations} migrations | ⚡ ${this.stats.nearGraduations} near | 🛡️ ${this.stats.duplicatePrevented} duplicates prevented | ${uptime}s uptime`);
    }, 60000);
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Fixed Graduation Detector...');
    
    if (this.progressionStream) this.progressionStream.end();
    if (this.migrationStream) this.migrationStream.end();
    if (this.dbClient) await this.dbClient.end();
    
    console.log('✅ All streams stopped');
  }

  getStats() {
    return { 
      ...this.stats, 
      isConnected: this.isConnected,
      knownGraduations: this.knownGraduations.size 
    };
  }
}

// Test runner
async function runFixedDetector(): Promise<void> {
  console.log('🎯 Fixed Graduation Detection - No More Database Errors!\n');

  const detector = new FixedGraduationDetector();

  detector.on('tokenGraduated', (graduation) => {
    console.log(`🎊 GRADUATION EVENT: ${graduation.tokenAddress} completed with $${graduation.finalMarketCap.toLocaleString()} market cap!`);
  });

  detector.on('tokenMigrated', (migration) => {
    console.log(`🌊 MIGRATION EVENT: Raydium migration completed! Signature: ${migration.migrationSignature}`);
  });

  console.log('🎬 Starting fixed detection system...');
  console.log('✅ No more foreign key errors!');
  console.log('✅ Better duplicate prevention!');
  console.log('✅ Proper token address mapping!');
  console.log('Press Ctrl+C to stop\n');

  try {
    await detector.start();
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : 'Unknown error');
    await detector.stop();
  }
}

export { FixedGraduationDetector };

if (require.main === module) {
  runFixedDetector().catch(error => {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  });
}