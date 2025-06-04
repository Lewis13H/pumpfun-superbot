const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB
});

class ParallelScanner {
  constructor(concurrency = 10) {
    this.concurrency = concurrency;
    this.scanning = false;
    this.stats = {
      scanned: 0,
      updated: 0,
      errors: 0,
      startTime: Date.now()
    };
  }

  async start() {
    console.log(`Starting parallel scanner with ${this.concurrency} workers...\n`);
    this.scanning = true;
    
    // Create worker promises
    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this.worker(i));
    }
    
    // Status reporter
    const statusInterval = setInterval(() => {
      const elapsed = (Date.now() - this.stats.startTime) / 1000;
      const rate = this.stats.scanned / elapsed;
      console.log(`Stats: ${this.stats.scanned} scanned, ${this.stats.updated} updated, ${rate.toFixed(1)} tokens/sec`);
    }, 10000);
    
    // Wait for all workers
    await Promise.all(workers);
    clearInterval(statusInterval);
  }

  async worker(id) {
    console.log(`Worker ${id} started`);
    
    while (this.scanning) {
      try {
        // Get next token to scan
        const token = await this.getNextToken();
        if (!token) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        // Scan the token
        await this.scanToken(token);
        this.stats.scanned++;
        
      } catch (error) {
        console.error(`Worker ${id} error:`, error.message);
        this.stats.errors++;
      }
    }
  }

  async getNextToken() {
    // Prioritize tokens that haven't been scanned recently
    const result = await pool.query(`
      SELECT address, symbol, category, market_cap
      FROM tokens
      WHERE category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
        AND (last_scan_at IS NULL OR last_scan_at < NOW() - INTERVAL '5 minutes')
      ORDER BY 
        CASE category
          WHEN 'AIM' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'NEW' THEN 4
          WHEN 'LOW' THEN 5
        END,
        last_scan_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    
    return result.rows[0];
  }

  async scanToken(token) {
    const startTime = Date.now();
    
    try {
      // Get fresh market data from Birdeye
      const response = await axios.get(
        `https://public-api.birdeye.so/defi/token_overview?address=${token.address}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-API-KEY': process.env.BIRDEYE_API_KEY
          },
          timeout: 5000
        }
      );
      
      const data = response.data.data;
      if (!data) return;
      
      // Update token data
      const updateResult = await pool.query(`
        UPDATE tokens 
        SET 
          market_cap = $1,
          liquidity = $2,
          holders = $3,
          volume_24h = $4,
          last_scan_at = NOW(),
          updated_at = NOW()
        WHERE address = $5
        RETURNING category
      `, [
        data.marketCap || token.market_cap,
        data.liquidity || 0,
        data.holder || null,
        data.v24hUSD || 0,
        token.address
      ]);
      
      if (updateResult.rows[0]?.category !== token.category) {
        console.log(`✓ ${token.symbol}: ${token.category} → ${updateResult.rows[0].category} ($${data.marketCap})`);
        this.stats.updated++;
      }
      
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }
  }

  stop() {
    this.scanning = false;
    console.log('\nStopping scanner...');
  }
}

// Run the scanner
const scanner = new ParallelScanner(20); // 20 concurrent workers

// Graceful shutdown
process.on('SIGINT', () => {
  scanner.stop();
  setTimeout(() => process.exit(0), 2000);
});

scanner.start().catch(console.error);