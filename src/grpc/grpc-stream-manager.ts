// src/grpc/grpc-stream-manager.ts - FINAL VERSION WITH DETAILED ERROR LOGGING

import { YellowstoneGrpcClient, TokenPrice, TokenTransaction } from './yellowstone-grpc-client';
import { Knex } from 'knex';
import { logger } from '../utils/logger';
import { config } from '../config';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
const { HELIUS_METADATA_SERVICE } = require('../services/helius-metadata-service');
import { EventEmitter } from 'events';

export interface StreamManagerConfig {
  grpcEndpoint: string;
  grpcToken: string;
  batchSize?: number;
  flushInterval?: number;
  priceChangeInterval?: number;
}

interface BatchBuffers {
  prices: TokenPrice[];
  transactions: TokenTransaction[];
  newTokens: Map<string, NewToken>;
}

interface NewToken {
  address: string;
  symbol: string;
  name: string;
  bondingCurve?: string;
  creator: string;
  createdAt: Date;
  discoverySignature: string;
  discoverySlot: number;
}

export class GrpcStreamManager extends EventEmitter {
  private grpcClient: YellowstoneGrpcClient;
  private db: Knex;
  private categoryManager: CategoryManager;
  private buySignalEvaluator: BuySignalEvaluator;
  private solPriceUsd: number = 100;
  
  private buffers: BatchBuffers = {
    prices: [],
    transactions: [],
    newTokens: new Map()
  };
  
  private stats = {
    pricesProcessed: 0,
    transactionsProcessed: 0,
    newTokensDiscovered: 0,
    buysDetected: 0,
    sellsDetected: 0,
    errors: 0,
    lastFlush: new Date()
  };
  
  private flushTimer?: NodeJS.Timeout;
  private priceChangeTimer?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;
  private isRunning = false;
  
  private readonly config: Required<StreamManagerConfig>;
  
  constructor(
    config: StreamManagerConfig,
    db: Knex,
    categoryManager: CategoryManager,
    buySignalEvaluator: BuySignalEvaluator
  ) {
    super();
    
    this.config = {
      batchSize: 1000,
      flushInterval: 1000,
      priceChangeInterval: 5 * 60 * 1000,
      ...config
    };
    
    this.db = db;
    this.categoryManager = categoryManager;
    this.buySignalEvaluator = buySignalEvaluator;
    
    this.grpcClient = new YellowstoneGrpcClient({
      endpoint: this.config.grpcEndpoint,
      token: this.config.grpcToken
    });
    
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    // Handle price updates
    this.grpcClient.on('priceUpdate', async (price: TokenPrice) => {
      await this.handlePriceUpdate(price);
    });
    
    // Handle transactions
    this.grpcClient.on('transaction', async (tx: TokenTransaction) => {
      await this.handleTransaction(tx);
    });
    
    // Handle new tokens
    this.grpcClient.on('tokenCreated', async (tx: TokenTransaction) => {
      await this.handleNewToken(tx);
      
      // Queue for Helius metadata fetch
      HELIUS_METADATA_SERVICE.queueTokenForMetadata(tx.tokenAddress);
      logger.info(`📝 Queued metadata fetch for: ${tx.tokenAddress.substring(0, 8)}...`);
    });
    
    // Handle errors
    this.grpcClient.on('error', (error: Error) => {
      logger.error('gRPC client error:', error.message);
      this.stats.errors++;
      this.emit('error', error);
    });
    
    // Handle connection events
    this.grpcClient.on('connected', () => {
      logger.info('✅ gRPC stream connected');
      this.emit('connected');
    });
    
    this.grpcClient.on('disconnected', () => {
      logger.warn('⚠️ gRPC stream disconnected');
      this.emit('disconnected');
    });
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Stream manager already running');
      return;
    }
    
    logger.info('🚀 Starting gRPC stream manager...');
    
    try {
      // Test database connection
      await this.db.raw('SELECT NOW()');
      logger.info('✅ Database connection verified');
      
      // Get current SOL price if available
      try {
        const solPrice = await this.db('sol_price_history')
          .orderBy('timestamp', 'desc')
          .first();
        if (solPrice) {
          this.solPriceUsd = solPrice.price;
          this.grpcClient.setSolPrice(solPrice.price);
        }
      } catch (error) {
        logger.warn('Could not fetch SOL price, using default');
      }
      
      // Connect to gRPC
      await this.grpcClient.connect();
      
      // Start timers
      this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
      this.priceChangeTimer = setInterval(() => this.calculatePriceChanges(), this.config.priceChangeInterval);
      
      // Start Helius metadata batch fixing (after 30 seconds)
      setTimeout(async () => {
        const fixed = await HELIUS_METADATA_SERVICE.fixMissingMetadata(50);
        logger.info(`🔧 Fixed metadata for ${fixed} tokens on startup`);
      }, 30000);
      
      // Clean stats display every 2 minutes
      this.statsTimer = setInterval(() => {
        this.displayCleanStats();
      }, 120000);
      
      this.isRunning = true;
      
      logger.info('✅ Stream manager started successfully');
      this.emit('started');
      
    } catch (error) {
      logger.error('Failed to start stream manager:', error);
      throw error;
    }
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    logger.info('🛑 Stopping stream manager...');
    
    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    if (this.priceChangeTimer) {
      clearInterval(this.priceChangeTimer);
      this.priceChangeTimer = undefined;
    }
    
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
    
    // Flush remaining data
    await this.flush();
    
    // Disconnect gRPC
    await this.grpcClient.disconnect();
    
    this.isRunning = false;
    
    logger.info('✅ Stream manager stopped');
    this.emit('stopped');
  }
  
  private async handlePriceUpdate(price: TokenPrice): Promise<void> {
    try {
      if (!price.tokenAddress) {
        return;
      }
      
      // Check if token exists in database
      const tokenExists = await this.db('tokens')
        .where('address', price.tokenAddress)
        .first();
      
      if (!tokenExists) {
        // Create token if it doesn't exist with placeholder
        await this.db('tokens')
          .insert({
            address: price.tokenAddress,
            symbol: 'LOADING...',
            name: 'Loading...',
            category: 'NEW',
            current_price_usd: price.priceUsd,
            current_price_sol: price.priceSol,
            market_cap: price.marketCap,
            liquidity: price.liquidityUsd / this.solPriceUsd,
            curve_progress: price.curveProgress || 0,
            last_price_update: new Date(),
            created_at: new Date()
          })
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'market_cap', 'liquidity', 'curve_progress', 'last_price_update']);
        
        // Queue for metadata fetch
        HELIUS_METADATA_SERVICE.queueTokenForMetadata(price.tokenAddress);
      } else {
        // Update existing token
        await this.db('tokens')
          .where('address', price.tokenAddress)
          .update({
            current_price_usd: price.priceUsd,
            current_price_sol: price.priceSol,
            market_cap: price.marketCap,
            liquidity: price.liquidityUsd / this.solPriceUsd,
            curve_progress: price.curveProgress || 0,
            last_price_update: new Date(),
            price_update_count: this.db.raw('price_update_count + 1'),
            updated_at: new Date()
          });
      }
      
      // Add to buffer for time-series storage
      this.buffers.prices.push({
        ...price,
        curveProgress: price.curveProgress || 0,
        totalSupply: price.totalSupply || 0,
        isComplete: price.isComplete || false
      });
      
      this.stats.pricesProcessed++;
      
      // Check category transitions
      if (tokenExists) {
        const previousCategory = tokenExists.category;
        const newCategory = this.determineCategory(price.marketCap);
        
        if (previousCategory && previousCategory !== newCategory) {
          await this.categoryManager.updateTokenCategory(price.tokenAddress, newCategory, price.marketCap);
          
          logger.info(`📊 CATEGORY: ${price.tokenAddress.substring(0, 8)}... ${previousCategory} → ${newCategory} ($${price.marketCap.toFixed(0)})`);
          
          await this.db('category_transitions').insert({
            token_address: price.tokenAddress,
            from_category: previousCategory,
            to_category: newCategory,
            market_cap_at_transition: price.marketCap,
            reason: 'market_cap_threshold',
            created_at: new Date()
          });
        }
      }
      
      // Check for buy signals on AIM tokens
      if (price.marketCap >= 35000 && price.marketCap <= 105000) {
        await this.evaluateBuySignal(price.tokenAddress, price);
      }
      
      // Flush if buffer is full
      if (this.buffers.prices.length >= this.config.batchSize) {
        await this.flush();
      }
      
    } catch (error: any) {
      logger.error('Error handling price update:', error?.message);
      this.stats.errors++;
    }
  }
  
  private determineCategory(marketCap: number): string {
    if (marketCap < 5000) return 'NEW';
    if (marketCap < 15000) return 'LOW';
    if (marketCap < 35000) return 'MEDIUM';
    if (marketCap < 105000) return 'HIGH';
    if (marketCap < 500000) return 'AIM';
    return 'ARCHIVE';
  }
  
  private async handleTransaction(tx: TokenTransaction): Promise<void> {
    try {
      if (tx.type === 'create') {
        return; // Handled by handleNewToken
      }
      
      if (tx.tokenAddress === 'unknown') {
        return;
      }
      
      this.buffers.transactions.push(tx);
      this.stats.transactionsProcessed++;
      
      if (tx.type === 'buy') {
        this.stats.buysDetected++;
      } else if (tx.type === 'sell') {
        this.stats.sellsDetected++;
      }
      
      // Flush if buffer is full
      if (this.buffers.transactions.length >= this.config.batchSize) {
        await this.flush();
      }
      
    } catch (error: any) {
      logger.error('Error handling transaction:', error?.message);
      this.stats.errors++;
    }
  }
  
  private async handleNewToken(tx: TokenTransaction): Promise<void> {
    try {
      if (!tx.tokenAddress) {
        return;
      }
      
      // Check if token already exists
      const exists = await this.db('tokens')
        .where('address', tx.tokenAddress)
        .first();
      
      if (exists) {
        return;
      }
      
      const newToken: NewToken = {
        address: tx.tokenAddress,
        symbol: 'LOADING...',
        name: 'Loading...',
        bondingCurve: tx.bondingCurve,
        creator: tx.userAddress,
        createdAt: tx.timestamp,
        discoverySignature: tx.signature,
        discoverySlot: tx.slot
      };
      
      // Insert token immediately with placeholder metadata
      try {
        await this.db('tokens')
          .insert({
            address: newToken.address,
            symbol: newToken.symbol,
            name: newToken.name,
            category: 'NEW',
            bonding_curve: newToken.bondingCurve || null,
            created_at: newToken.createdAt,
            discovery_signature: newToken.discoverySignature,
            discovery_slot: newToken.discoverySlot
          })
          .onConflict('address')
          .ignore();
        
        logger.info(`🆕 NEW TOKEN: ${tx.tokenAddress.substring(0, 8)}... | Metadata loading...`);
        this.stats.newTokensDiscovered++;
        
        this.emit('newToken', newToken);
        
      } catch (error: any) {
        logger.error(`Failed to insert token ${tx.tokenAddress}:`, error?.message);
        this.buffers.newTokens.set(tx.tokenAddress, newToken);
      }
      
    } catch (error: any) {
      logger.error('Error handling new token:', error?.message);
      this.stats.errors++;
    }
  }
  
  private async evaluateBuySignal(tokenAddress: string, price: TokenPrice): Promise<void> {
    try {
      const token = await this.db('tokens')
        .where('address', tokenAddress)
        .first();
      
      if (!token || token.buy_attempts >= 3) {
        return;
      }
      
      token.market_cap = price.marketCap;
      token.current_price_usd = price.priceUsd;
      token.liquidity = price.liquidityUsd / this.solPriceUsd;
      
      if (!token.holders || !token.top_10_percent || !token.solsniffer_score) {
        return;
      }
      
      const evaluation = await this.buySignalEvaluator.evaluateToken(token.address);
      
      if (evaluation && evaluation.passed) {
        logger.info(`🚨 BUY SIGNAL: ${tokenAddress.substring(0, 8)}... | Signal detected`);
        this.emit('buySignal', { token, evaluation });
      }
      
    } catch (error: any) {
      // Silent fail for buy signal evaluation
    }
  }
  
  private async flush(): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 Starting flush with ${this.buffers.prices.length} prices, ${this.buffers.transactions.length} transactions, ${this.buffers.newTokens.size} new tokens`);
      
      await this.db.transaction(async (trx) => {
        if (this.buffers.newTokens.size > 0) {
          logger.info(`📝 Flushing ${this.buffers.newTokens.size} new tokens...`);
          await this.flushNewTokens(trx);
          logger.info(`✅ New tokens flushed successfully`);
        }
        
        if (this.buffers.prices.length > 0) {
          logger.info(`📈 Flushing ${this.buffers.prices.length} prices...`);
          await this.flushPrices(trx);
          logger.info(`✅ Prices flushed successfully`);
        }
        
        if (this.buffers.transactions.length > 0) {
          logger.info(`💰 Flushing ${this.buffers.transactions.length} transactions...`);
          await this.flushTransactions(trx);
          logger.info(`✅ Transactions flushed successfully`);
        }
      });
      
      const duration = Date.now() - startTime;
      logger.info(`✅ Flush completed successfully in ${duration}ms`);
      
      this.stats.lastFlush = new Date();
      this.emit('flushed', {
        prices: this.buffers.prices.length,
        transactions: this.buffers.transactions.length,
        newTokens: this.buffers.newTokens.size,
        duration
      });
      
      // Clear buffers
      this.buffers.prices = [];
      this.buffers.transactions = [];
      this.buffers.newTokens.clear();
      
    } catch (error: any) {
      logger.error('❌ DETAILED FLUSH ERROR:', {
        message: error?.message || 'No error message',
        code: error?.code || 'No error code',
        detail: error?.detail || 'No error detail',
        hint: error?.hint || 'No error hint',
        stack: error?.stack || 'No stack trace',
        bufferSizes: {
          prices: this.buffers.prices.length,
          transactions: this.buffers.transactions.length,
          newTokens: this.buffers.newTokens.size
        }
      });
      
      this.stats.errors++;
      
      // Clear buffers to prevent memory buildup
      this.buffers.prices = [];
      this.buffers.transactions = [];
      this.buffers.newTokens.clear();
    }
  }
  
  private async flushNewTokens(trx: Knex.Transaction): Promise<void> {
    const tokens = Array.from(this.buffers.newTokens.values());
    
    const insertData = tokens.map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      category: 'NEW',
      bonding_curve: token.bondingCurve || null,
      created_at: token.createdAt,
      discovery_signature: token.discoverySignature,
      discovery_slot: token.discoverySlot
    }));
    
    await trx('tokens')
      .insert(insertData)
      .onConflict('address')
      .ignore();
  }
  
  private async flushPrices(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.prices.length === 0) return;
    
    try {
      logger.info(`🔍 Processing ${this.buffers.prices.length} price updates...`);
      
      // Ensure all tokens exist in the database
      const uniqueTokenAddresses = [...new Set(this.buffers.prices.map(p => p.tokenAddress))];
      logger.info(`🎯 Found ${uniqueTokenAddresses.length} unique token addresses`);
      
      const existingTokens = await trx('tokens')
        .whereIn('address', uniqueTokenAddresses)
        .pluck('address');
      
      const existingTokenSet = new Set(existingTokens);
      const missingTokens = uniqueTokenAddresses.filter(addr => !existingTokenSet.has(addr));
      
      logger.info(`📊 Tokens: ${existingTokens.length} existing, ${missingTokens.length} missing`);
      
      // Insert any missing tokens with minimal data
      if (missingTokens.length > 0) {
        logger.info(`➕ Inserting ${missingTokens.length} missing tokens...`);
        
        const tokensToInsert = missingTokens.map(address => ({
          address,
          symbol: 'LOADING...',
          name: 'Loading...',
          category: 'NEW',
          created_at: new Date(),
          current_price_usd: this.buffers.prices.find(p => p.tokenAddress === address)?.priceUsd || 0,
          current_price_sol: this.buffers.prices.find(p => p.tokenAddress === address)?.priceSol || 0,
          market_cap: this.buffers.prices.find(p => p.tokenAddress === address)?.marketCap || 0,
          last_price_update: new Date()
        }));
        
        await trx('tokens')
          .insert(tokensToInsert)
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'market_cap', 'last_price_update']);
        
        logger.info(`✅ Missing tokens inserted successfully`);
      }
      
      // Insert price data
      logger.info(`📊 Preparing price data for time-series insertion...`);
      
      const rawInsertData = this.buffers.prices.map(price => ({
        token_address: price.tokenAddress,
        time: price.timestamp,
        price_usd: price.priceUsd,
        price_sol: price.priceSol,
        virtual_sol_reserves: price.virtualSolReserves?.toString() || '0',
        virtual_token_reserves: price.virtualTokenReserves?.toString() || '0',
        real_sol_reserves: price.realSolReserves?.toString() || '0',
        real_token_reserves: price.realTokenReserves?.toString() || '0',
        market_cap: price.marketCap,
        liquidity_usd: price.liquidityUsd,
        slot: price.slot,
        source: 'grpc'
      }));
      
      // CRITICAL: Deduplicate by (token_address, time) to avoid "cannot affect row a second time" error
      const deduplicatedData = new Map<string, any>();
      
      for (const record of rawInsertData) {
        const key = `${record.token_address}_${record.time.getTime()}`;
        
        // Keep the latest record for each (token_address, time) combination
        if (!deduplicatedData.has(key) || record.slot > (deduplicatedData.get(key)?.slot || 0)) {
          deduplicatedData.set(key, record);
        }
      }
      
      const insertData = Array.from(deduplicatedData.values());
      
      logger.info(`📊 Deduplicated: ${rawInsertData.length} → ${insertData.length} price records (removed ${rawInsertData.length - insertData.length} duplicates)`);
      
      if (insertData.length === 0) {
        logger.info(`⚠️ No price data to insert after deduplication`);
        return;
      }
      
      // Insert in batches
      const batchSize = 50; // Smaller batch size
      logger.info(`📦 Inserting ${insertData.length} prices in batches of ${batchSize}...`);
      
      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        
        try {
          logger.info(`📝 Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(insertData.length/batchSize)} (${batch.length} records)...`);
          
          await trx.raw(`
            INSERT INTO timeseries.token_prices (
              token_address, time, price_usd, price_sol,
              virtual_sol_reserves, virtual_token_reserves,
              real_sol_reserves, real_token_reserves,
              market_cap, liquidity_usd, slot, source
            ) VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}
            ON CONFLICT (token_address, time) DO UPDATE SET
              price_usd = EXCLUDED.price_usd,
              price_sol = EXCLUDED.price_sol,
              market_cap = EXCLUDED.market_cap,
              liquidity_usd = EXCLUDED.liquidity_usd
          `, batch.flatMap(d => [
            d.token_address,
            d.time,
            d.price_usd,
            d.price_sol,
            d.virtual_sol_reserves,
            d.virtual_token_reserves,
            d.real_sol_reserves,
            d.real_token_reserves,
            d.market_cap,
            d.liquidity_usd,
            d.slot,
            d.source
          ]));
          
          logger.info(`✅ Batch ${Math.floor(i/batchSize) + 1} inserted successfully`);
          
        } catch (batchError: any) {
          logger.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, {
            message: batchError?.message,
            code: batchError?.code,
            detail: batchError?.detail,
            batchSize: batch.length,
            sampleData: batch[0]
          });
          throw batchError; // Re-throw to fail the transaction
        }
      }
      
      logger.info(`✅ All price batches inserted successfully`);
      
    } catch (error: any) {
      logger.error(`❌ PRICE FLUSH ERROR:`, {
        message: error?.message || 'No message',
        code: error?.code || 'No code',
        detail: error?.detail || 'No detail',
        priceCount: this.buffers.prices.length
      });
      throw error; // Re-throw to fail the transaction
    }
  }
  
  private async flushTransactions(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.transactions.length === 0) return;
    
    try {
      logger.info(`💰 Processing ${this.buffers.transactions.length} transactions...`);
      
      // Filter out transactions with unknown token address
      const validTransactions = this.buffers.transactions.filter(tx => 
        tx.tokenAddress && tx.tokenAddress !== 'unknown'
      );
      
      if (validTransactions.length === 0) {
        logger.info(`⚠️ No valid transactions to process`);
        return;
      }
      
      logger.info(`💰 ${validTransactions.length} valid transactions after filtering`);
      
      // CRITICAL: Ensure all tokens exist in the database before inserting transactions
      const uniqueTokenAddresses = [...new Set(validTransactions.map(tx => tx.tokenAddress))];
      logger.info(`🎯 Found ${uniqueTokenAddresses.length} unique token addresses in transactions`);
      
      const existingTokens = await trx('tokens')
        .whereIn('address', uniqueTokenAddresses)
        .pluck('address');
      
      const existingTokenSet = new Set(existingTokens);
      const missingTokens = uniqueTokenAddresses.filter(addr => !existingTokenSet.has(addr));
      
      logger.info(`📊 Transaction tokens: ${existingTokens.length} existing, ${missingTokens.length} missing`);
      
      // Insert any missing tokens with minimal data BEFORE inserting transactions
      if (missingTokens.length > 0) {
        logger.info(`➕ Inserting ${missingTokens.length} missing tokens for transactions...`);
        
        const tokensToInsert = missingTokens.map(address => {
          // Find a sample transaction for this token to get some data
          const sampleTx = validTransactions.find(tx => tx.tokenAddress === address);
          
          return {
            address,
            symbol: 'LOADING...',
            name: 'Loading...',
            category: 'NEW',
            created_at: sampleTx?.timestamp || new Date(),
            current_price_usd: sampleTx?.priceUsd || 0,
            current_price_sol: sampleTx?.priceSol || 0,
            market_cap: 0,
            last_price_update: new Date()
          };
        });
        
        await trx('tokens')
          .insert(tokensToInsert)
          .onConflict('address')
          .merge(['current_price_usd', 'current_price_sol', 'last_price_update']);
        
        logger.info(`✅ Missing tokens for transactions inserted successfully`);
        
        // Queue missing tokens for metadata fetch
        for (const tokenAddress of missingTokens) {
          HELIUS_METADATA_SERVICE.queueTokenForMetadata(tokenAddress);
          logger.debug(`📝 Queued metadata fetch for transaction token: ${tokenAddress.substring(0, 8)}...`);
        }
      }
      
      // Now insert transactions (all tokens guaranteed to exist)
      logger.info(`📊 Preparing transaction data for insertion...`);
      
      const insertData = validTransactions.map(tx => ({
        signature: tx.signature,
        token_address: tx.tokenAddress,
        time: tx.timestamp,
        type: tx.type,
        user_address: tx.userAddress,
        token_amount: tx.tokenAmount?.toString() || '0',
        sol_amount: tx.solAmount?.toString() || '0',
        price_usd: tx.priceUsd,
        price_sol: tx.priceSol,
        slot: tx.slot,
        fee: tx.fee?.toString() || '0'
      }));
      
      // Insert in batches
      const batchSize = 50; // Smaller batch size to reduce conflicts
      logger.info(`📦 Inserting ${insertData.length} transactions in batches of ${batchSize}...`);
      
      for (let i = 0; i < insertData.length; i += batchSize) {
        const batch = insertData.slice(i, i + batchSize);
        
        try {
          logger.info(`📝 Inserting transaction batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(insertData.length/batchSize)} (${batch.length} records)...`);
          
          await trx('timeseries.token_transactions')
            .insert(batch)
            .onConflict(['signature', 'token_address', 'time'])
            .ignore();
          
          logger.info(`✅ Transaction batch ${Math.floor(i/batchSize) + 1} inserted successfully`);
          
        } catch (batchError: any) {
          logger.error(`❌ Transaction batch ${Math.floor(i/batchSize) + 1} failed:`, {
            message: batchError?.message,
            code: batchError?.code,
            detail: batchError?.detail,
            batchSize: batch.length,
            sampleData: batch[0]
          });
          throw batchError; // Re-throw to fail the transaction
        }
      }
      
      logger.info(`✅ All transaction batches inserted successfully`);
      
    } catch (error: any) {
      logger.error(`❌ TRANSACTION FLUSH ERROR:`, {
        message: error?.message || 'No message',
        code: error?.code || 'No code',
        detail: error?.detail || 'No detail',
        transactionCount: this.buffers.transactions.length
      });
      throw error; // Re-throw to fail the transaction
    }
  }
  
  private async calculatePriceChanges(): Promise<void> {
    try {
      await this.db.raw('SELECT calculate_price_changes()');
    } catch (error: any) {
      this.stats.errors++;
    }
  }
  
  // Clean stats display
  private displayCleanStats(): void {
    const heliusStats = HELIUS_METADATA_SERVICE.getStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('🚀 PUMP.FUN BOT STATUS (HELIUS INTEGRATED)');
    console.log('='.repeat(60));
    console.log(`📊 Processed: ${this.stats.pricesProcessed} prices | ${this.stats.newTokensDiscovered} new tokens`);
    console.log(`💰 Activity: ${this.stats.buysDetected} buys | ${this.stats.sellsDetected} sells`);
    console.log(`📝 Metadata Queue: ${heliusStats.processingQueue} processing | ${heliusStats.retryQueue} retrying`);
    console.log(`❌ Errors: ${this.stats.errors}`);
    console.log(`🕐 Last Flush: ${this.stats.lastFlush.toLocaleTimeString()}`);
    console.log('='.repeat(60) + '\n');
  }
  
  getStats() {
    return {
      ...this.stats,
      bufferSizes: {
        prices: this.buffers.prices.length,
        transactions: this.buffers.transactions.length,
        newTokens: this.buffers.newTokens.size
      },
      isRunning: this.isRunning,
      grpcConnected: this.grpcClient.isActive(),
      metadata: HELIUS_METADATA_SERVICE.getStats()
    };
  }
}