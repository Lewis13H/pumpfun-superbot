// src/grpc/grpc-stream-manager.ts - V5 with improved token and price handling

import { YellowstoneGrpcClient, TokenPrice, TokenTransaction } from './yellowstone-grpc-client';
import { Knex } from 'knex';
import { logger } from '../utils/logger';
import { config } from '../config';
import { CategoryManager } from '../category/category-manager';
import { BuySignalEvaluator } from '../trading/buy-signal-evaluator';
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
  private solPriceUsd: number = 100; // Default SOL price
  
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
      priceChangeInterval: 5 * 60 * 1000, // 5 minutes
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
    });
    
    // Handle near graduation events
    this.grpcClient.on('nearGraduation', (data: any) => {
      logger.info(`🎓 Token near graduation: ${data.tokenAddress} at ${data.progress.toFixed(2)}%`);
      this.emit('nearGraduation', data);
    });
    
    // Handle errors
    this.grpcClient.on('error', (error: Error) => {
      logger.error('gRPC client error:', error);
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
      
      // Start flush timer
      this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
      
      // Start price change calculator
      this.priceChangeTimer = setInterval(() => this.calculatePriceChanges(), this.config.priceChangeInterval);
      
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
      // Validate token exists
      if (!price.tokenAddress) {
        logger.warn('Price update missing token address');
        return;
      }
      
      logger.debug(`Received price update for ${price.tokenAddress} - Price: ${price.priceUsd.toFixed(6)}, MC: ${price.marketCap.toFixed(2)}`);
      
      // Check if token is in the new tokens buffer FIRST
      const tokenInBuffer = this.buffers.newTokens.has(price.tokenAddress);
      
      // Check if token exists in database
      const tokenExists = await this.db('tokens')
        .where('address', price.tokenAddress)
        .first();
      
      if (!tokenInBuffer && !tokenExists) {
        // Token doesn't exist anywhere, create it with price data
        logger.info(`Creating token ${price.tokenAddress} from price update`);
        
        await this.db('tokens')
          .insert({
            address: price.tokenAddress,
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
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
      } else if (tokenExists) {
        // Update main tokens table immediately with latest metrics
        await this.db('tokens')
          .where('address', price.tokenAddress)
          .update({
            current_price_usd: price.priceUsd,
            current_price_sol: price.priceSol,
            market_cap: price.marketCap,
            liquidity: price.liquidityUsd / this.solPriceUsd, // Convert USD to SOL
            curve_progress: price.curveProgress || 0,
            last_price_update: new Date(),
            price_update_count: this.db.raw('price_update_count + 1'),
            updated_at: new Date()
          });
        
        logger.debug(`Updated token ${price.tokenAddress} in database`);
      } else {
        // Token is in buffer but not in database yet
        logger.debug(`Token ${price.tokenAddress} is in buffer, will update after flush`);
      }
      
      // Always add price data to buffer for time-series storage
      this.buffers.prices.push({
        ...price,
        // Ensure we have all the data we need
        curveProgress: price.curveProgress || 0,
        totalSupply: price.totalSupply || 0,
        isComplete: price.isComplete || false
      });
      
      this.stats.pricesProcessed++;
      logger.info(`💰 Price processed for ${price.tokenAddress} - Total processed: ${this.stats.pricesProcessed}`);
      
      // Check category based on market cap
      if (tokenExists) {
        const previousCategory = tokenExists.category;
        const newCategory = this.determineCategory(price.marketCap);
        
        // If category changed, update and log transition
        if (previousCategory && previousCategory !== newCategory) {
          await this.categoryManager.updateTokenCategory(price.tokenAddress, newCategory, price.marketCap);
          
          logger.info(`📊 Category transition: ${price.tokenAddress} ${previousCategory} → ${newCategory} (MC: ${price.marketCap.toFixed(2)})`);
          
          // Track category transition
          await this.db('category_transitions').insert({
            token_address: price.tokenAddress,
            from_category: previousCategory,
            to_category: newCategory,
            market_cap_at_transition: price.marketCap,
            transitioned_at: new Date()
          });
        }
      }
      
      // Check if we should evaluate for buy signals
      if (price.marketCap >= 35000 && price.marketCap <= 105000) {
        // Token is in AIM range - evaluate immediately
        await this.evaluateBuySignal(price.tokenAddress, price);
      }
      
      // Emit events for specific conditions
      if (price.curveProgress && price.curveProgress > 80 && !price.isComplete) {
        this.emit('nearGraduation', {
          tokenAddress: price.tokenAddress,
          progress: price.curveProgress,
          marketCap: price.marketCap
        });
      }
      
      // Check for rapid price movements (pump detection)
      await this.checkPriceMovement(price);
      
      // Flush if buffer is full
      if (this.buffers.prices.length >= this.config.batchSize) {
        await this.flush();
      }
      
    } catch (error) {
      logger.error('Error handling price update:', error);
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
  
  private async checkPriceMovement(currentPrice: TokenPrice): Promise<void> {
    try {
      // Get price from 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const previousPrice = await this.db('timeseries.token_prices')
        .where('token_address', currentPrice.tokenAddress)
        .where('time', '<=', fiveMinutesAgo)
        .orderBy('time', 'desc')
        .first();
      
      if (previousPrice) {
        const priceChange = ((currentPrice.priceUsd - previousPrice.price_usd) / previousPrice.price_usd) * 100;
        
        // Detect pumps (>20% in 5 minutes)
        if (priceChange > 20) {
          logger.info(`🚀 PUMP DETECTED: ${currentPrice.tokenAddress} +${priceChange.toFixed(2)}% in 5 min`);
          
          this.emit('pumpDetected', {
            tokenAddress: currentPrice.tokenAddress,
            priceChange,
            previousPrice: previousPrice.price_usd,
            currentPrice: currentPrice.priceUsd,
            marketCap: currentPrice.marketCap
          });
          
          // Record pump event
          await this.db('pump_events').insert({
            token_address: currentPrice.tokenAddress,
            event_type: 'PUMP',
            price_change_percent: priceChange,
            price_before: previousPrice.price_usd,
            price_after: currentPrice.priceUsd,
            market_cap: currentPrice.marketCap,
            detected_at: new Date()
          });
        }
        
        // Detect dumps (< -20% in 5 minutes)
        if (priceChange < -20) {
          logger.warn(`📉 DUMP DETECTED: ${currentPrice.tokenAddress} ${priceChange.toFixed(2)}% in 5 min`);
          
          this.emit('dumpDetected', {
            tokenAddress: currentPrice.tokenAddress,
            priceChange,
            previousPrice: previousPrice.price_usd,
            currentPrice: currentPrice.priceUsd,
            marketCap: currentPrice.marketCap
          });
          
          // Record dump event
          await this.db('pump_events').insert({
            token_address: currentPrice.tokenAddress,
            event_type: 'DUMP',
            price_change_percent: priceChange,
            price_before: previousPrice.price_usd,
            price_after: currentPrice.priceUsd,
            market_cap: currentPrice.marketCap,
            detected_at: new Date()
          });
        }
      }
    } catch (error) {
      logger.error('Error checking price movement:', error);
    }
  }
  
  private async handleTransaction(tx: TokenTransaction): Promise<void> {
    try {
      // Skip create transactions - they're handled by handleNewToken
      if (tx.type === 'create') {
        return;
      }
      
      // Skip if token address is unknown
      if (tx.tokenAddress === 'unknown') {
        logger.debug('Skipping transaction with unknown token address');
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
      
    } catch (error) {
      logger.error('Error handling transaction:', error);
      this.stats.errors++;
    }
  }
  
  private async handleNewToken(tx: TokenTransaction): Promise<void> {
    try {
      if (!tx.tokenAddress) {
        logger.debug('No token address in transaction');
        return;
      }
      
      // Check if token already exists in database
      const exists = await this.db('tokens')
        .where('address', tx.tokenAddress)
        .first();
      
      if (exists) {
        logger.debug(`Token ${tx.tokenAddress} already exists in database`);
        return;
      }
      
      logger.debug(`Processing new token ${tx.tokenAddress} with bonding curve: ${tx.bondingCurve}`);
      
      const newToken: NewToken = {
        address: tx.tokenAddress,
        symbol: 'UNKNOWN', // Will be updated when we get metadata
        name: 'Unknown Token',
        bondingCurve: tx.bondingCurve,
        creator: tx.userAddress,
        createdAt: tx.timestamp,
        discoverySignature: tx.signature,
        discoverySlot: tx.slot
      };
      
      // Insert the token immediately instead of buffering
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
        
        logger.info(`✅ Immediately inserted new token: ${tx.tokenAddress}`);
        this.stats.newTokensDiscovered++;
        
        // Subscribe to the bonding curve for real-time updates if available
        if (tx.bondingCurve && this.grpcClient.isActive()) {
          logger.debug(`Subscribing to bonding curve: ${tx.bondingCurve} for token ${tx.tokenAddress}`);
          await this.grpcClient.subscribeToBondingCurve(tx.bondingCurve);
        } else {
          logger.warn(`No bonding curve found for token ${tx.tokenAddress}`);
        }
        
        this.emit('newToken', newToken);
        
      } catch (error) {
        logger.error(`Failed to insert token ${tx.tokenAddress}:`, error);
        // Fall back to buffering if immediate insert fails
        this.buffers.newTokens.set(tx.tokenAddress, newToken);
      }
      
    } catch (error) {
      logger.error('Error handling new token:', error);
      this.stats.errors++;
    }
  }
  
  private async evaluateBuySignal(tokenAddress: string, price: TokenPrice): Promise<void> {
    try {
      // Get token data from database
      const token = await this.db('tokens')
        .where('address', tokenAddress)
        .first();
      
      if (!token) {
        // Token not in database yet, will be evaluated after insertion
        return;
      }
      
      // Skip if we've already evaluated recently
      if (token.buy_attempts >= 3) {
        return;
      }
      
      // Update token with latest price data
      token.market_cap = price.marketCap;
      token.current_price_usd = price.priceUsd;
      token.liquidity = price.liquidityUsd / this.solPriceUsd;
      
      // Only evaluate if we have sufficient data
      if (!token.holders || !token.top_10_percent || !token.solsniffer_score) {
        logger.debug(`Skipping buy evaluation for ${tokenAddress} - insufficient data`);
        return;
      }
      
      // Evaluate buy signal
      const evaluation = await this.buySignalEvaluator.evaluateToken(token.address);
      
      if (evaluation && evaluation.passed) {
        logger.info(`💰 Buy signal generated for ${tokenAddress}`);
        this.emit('buySignal', { token, evaluation });
      }
      
    } catch (error) {
      logger.error('Error evaluating buy signal:', error);
    }
  }
  
  private async flush(): Promise<void> {
    const startTime = Date.now();
    
    try {
      await this.db.transaction(async (trx) => {
        // Insert new tokens FIRST (if any remain in buffer)
        if (this.buffers.newTokens.size > 0) {
          await this.flushNewTokens(trx);
        }
        
        // Insert prices
        if (this.buffers.prices.length > 0) {
          await this.flushPrices(trx);
        }
        
        // Insert transactions LAST (after tokens exist)
        if (this.buffers.transactions.length > 0) {
          await this.flushTransactions(trx);
        }
      });
      
      const duration = Date.now() - startTime;
      logger.debug(`✅ Flush completed in ${duration}ms`);
      
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
      
    } catch (error) {
      logger.error('Error during flush:', error);
      this.stats.errors++;
      
      // Don't let flush errors crash the app
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
      .ignore()
      .returning('*');
    
    logger.info(`📝 Inserted ${tokens.length} new tokens`);
  }
  
  private async flushPrices(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.prices.length === 0) return;
    
    // First, ensure all tokens exist in the database
    const uniqueTokenAddresses = [...new Set(this.buffers.prices.map(p => p.tokenAddress))];
    
    // Check which tokens exist
    const existingTokens = await trx('tokens')
      .whereIn('address', uniqueTokenAddresses)
      .pluck('address');
    
    const existingTokenSet = new Set(existingTokens);
    const missingTokens = uniqueTokenAddresses.filter(addr => !existingTokenSet.has(addr));
    
    // Insert any missing tokens with minimal data
    if (missingTokens.length > 0) {
      logger.warn(`Found ${missingTokens.length} tokens in price buffer that don't exist in database. Creating them...`);
      
      const tokensToInsert = missingTokens.map(address => ({
        address,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        category: 'NEW',
        created_at: new Date(),
        // Set initial price data from the first price update we have
        current_price_usd: this.buffers.prices.find(p => p.tokenAddress === address)?.priceUsd || 0,
        current_price_sol: this.buffers.prices.find(p => p.tokenAddress === address)?.priceSol || 0,
        market_cap: this.buffers.prices.find(p => p.tokenAddress === address)?.marketCap || 0,
        last_price_update: new Date()
      }));
      
      await trx('tokens')
        .insert(tokensToInsert)
        .onConflict('address')
        .merge(['current_price_usd', 'current_price_sol', 'market_cap', 'last_price_update']);
      
      logger.info(`Created ${missingTokens.length} missing tokens`);
    }
    
    // Now insert price data
    const insertData = this.buffers.prices.map(price => ({
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
    
    // Insert in smaller batches to avoid parameter limit
    const batchSize = 100;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < insertData.length; i += batchSize) {
      const batch = insertData.slice(i, i + batchSize);
      
      try {
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
            liquidity_usd = EXCLUDED.liquidity_usd,
            virtual_sol_reserves = EXCLUDED.virtual_sol_reserves,
            virtual_token_reserves = EXCLUDED.virtual_token_reserves,
            real_sol_reserves = EXCLUDED.real_sol_reserves,
            real_token_reserves = EXCLUDED.real_token_reserves
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
        
        successCount += batch.length;
      } catch (error) {
        logger.error(`Failed to insert batch of ${batch.length} prices:`, error);
        errorCount += batch.length;
      }
    }
    
    logger.info(`💰 Inserted ${successCount} price updates (${errorCount} failures)`);
    
    // Update volume calculations for affected tokens
    const uniqueTokens = [...new Set(this.buffers.prices.map(p => p.tokenAddress))];
    for (const tokenAddress of uniqueTokens) {
      await this.updateTokenVolume(trx, tokenAddress);
    }
  }
  
  private async updateTokenVolume(trx: Knex.Transaction, tokenAddress: string): Promise<void> {
    try {
      // Calculate 1h and 24h volume from transactions
      const volumes = await trx('timeseries.token_transactions')
        .where('token_address', tokenAddress)
        .select(
          trx.raw('SUM(CASE WHEN time > NOW() - INTERVAL \'1 hour\' THEN sol_amount::numeric * price_sol::numeric ELSE 0 END) as volume_1h'),
          trx.raw('SUM(CASE WHEN time > NOW() - INTERVAL \'24 hours\' THEN sol_amount::numeric * price_sol::numeric ELSE 0 END) as volume_24h')
        )
        .first();
      
      if (volumes) {
        await trx('tokens')
          .where('address', tokenAddress)
          .update({
            volume_1h: volumes.volume_1h || 0,
            volume_24h: volumes.volume_24h || 0
          });
      }
    } catch (error) {
      logger.error('Error updating token volume:', error);
    }
  }
  
  private async flushTransactions(trx: Knex.Transaction): Promise<void> {
    if (this.buffers.transactions.length === 0) return;
    
    // Filter out transactions with unknown token address
    const validTransactions = this.buffers.transactions.filter(tx => 
      tx.tokenAddress && tx.tokenAddress !== 'unknown'
    );
    
    if (validTransactions.length === 0) return;
    
    // First, ensure all referenced tokens exist
    const uniqueTokens = [...new Set(validTransactions.map(tx => tx.tokenAddress))];
    
    // Insert any missing tokens with minimal data
    const missingTokens = uniqueTokens.map(address => ({
      address,
      symbol: 'UNKNOWN',
      name: 'Unknown Token',
      category: 'NEW',
      created_at: new Date()
    }));
    
    await trx('tokens')
      .insert(missingTokens)
      .onConflict('address')
      .ignore();
    
    // Now insert transactions
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
    
    // Insert in smaller batches to avoid parameter limit
    const batchSize = 100;
    for (let i = 0; i < insertData.length; i += batchSize) {
      const batch = insertData.slice(i, i + batchSize);
      await trx('timeseries.token_transactions')
        .insert(batch)
        .onConflict(['signature', 'token_address', 'time'])
        .ignore();
    }
    
    logger.debug(`📝 Inserted ${validTransactions.length} transactions`);
  }
  
  private async calculatePriceChanges(): Promise<void> {
    try {
      await this.db.raw('SELECT calculate_price_changes()');
      logger.info('📊 Price changes calculated');
    } catch (error) {
      logger.error('Error calculating price changes:', error);
      this.stats.errors++;
    }
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
      grpcConnected: this.grpcClient.isActive()
    };
  }
}