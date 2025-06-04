// scripts/parallel-scanner-v2.js
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

class RateLimitedScanner {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5; // Reduced from 20
    this.requestsPerMinute = options.requestsPerMinute || 30; // Birdeye limit
    this.scanning = false;
    this.requestTimes = [];
    this.stats = {
      scanned: 0,
      updated: 0,
      errors: 0,
      rateLimited: 0,
      startTime: Date.now()
    };
  }

  async start() {
    console.log(`Starting rate-limited scanner with ${this.concurrency} workers...`);
    console.log(`Max ${this.requestsPerMinute} requests per minute\n`);
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
      console.log(`\n📊 Stats: ${this.stats.scanned} scanned, ${this.stats.updated} updated, ${rate.toFixed(1)} tokens/sec`);
      console.log(`   Errors: ${this.stats.errors}, Rate limited: ${this.stats.rateLimited}`);
    }, 30000);
    
    // Wait for all workers
    await Promise.all(workers);
    clearInterval(statusInterval);
  }

  async waitForRateLimit() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Remove old request times
    this.requestTimes = this.requestTimes.filter(time => time > oneMinuteAgo);
    
    // Check if we need to wait
    if (this.requestTimes.length >= this.requestsPerMinute) {
      const oldestRequest = Math.min(...this.requestTimes);
      const waitTime = 60000 - (now - oldestRequest) + 1000; // +1s buffer
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limit reached, waiting ${(waitTime/1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Record this request
    this.requestTimes.push(now);
  }

  async worker(id) {
    console.log(`Worker ${id} started`);
    
    while (this.scanning) {
      try {
        // Get next token to scan
        const token = await this.getNextToken();
        if (!token) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        // Wait for rate limit
        await this.waitForRateLimit();
        
        // Scan the token
        const updated = await this.scanToken(token, id);
        
        this.stats.scanned++;
        if (updated) this.stats.updated++;
        
      } catch (error) {
        console.error(`Worker ${id} error:`, error.message);
        this.stats.errors++;
        
        // Longer wait on errors
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async getNextToken() {
    // Prioritize AIM and HIGH categories, and tokens without recent scans
    const result = await pool.query(`
      SELECT address, symbol, category, market_cap, last_scan_at
      FROM tokens
      WHERE category IN ('NEW', 'LOW', 'MEDIUM', 'HIGH', 'AIM')
        AND (last_scan_at IS NULL OR last_scan_at < NOW() - INTERVAL '10 minutes')
        AND market_cap > 0
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

  async scanToken(token, workerId) {
    const startTime = Date.now();
    let retries = 3;
    
    while (retries > 0) {
      try {
        // Try Birdeye first
        const response = await axios.get(
          `https://public-api.birdeye.so/defi/token_overview?address=${token.address}`,
          {
            headers: {
              'Accept': 'application/json',
              'X-API-KEY': process.env.BIRDEYE_API_KEY
            },
            timeout: 10000
          }
        );
        
        const data = response.data.data;
        if (!data) return false;
        
        // Calculate what category it should be
        const newMarketCap = data.marketCap || token.market_cap;
        let expectedCategory;
        
        if (newMarketCap < 8000) expectedCategory = 'LOW';
        else if (newMarketCap < 19000) expectedCategory = 'MEDIUM';
        else if (newMarketCap < 35000) expectedCategory = 'HIGH';
        else if (newMarketCap <= 145000) expectedCategory = 'AIM';
        else expectedCategory = 'ARCHIVE';
        
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
          newMarketCap,
          data.liquidity || 0,
          data.holder || null,
          data.v24hUSD || 0,
          token.address
        ]);
        
        const newCategory = updateResult.rows[0]?.category;
        
        if (newCategory !== token.category) {
          console.log(`✅ Worker ${workerId}: ${token.symbol} ${token.category} → ${newCategory} ($${newMarketCap.toFixed(0)})`);
          return true;
        } else if (expectedCategory !== newCategory) {
          console.log(`⚠️  Worker ${workerId}: ${token.symbol} is ${newCategory} but should be ${expectedCategory} ($${newMarketCap.toFixed(0)})`);
        }
        
        return false;
        
      } catch (error) {
        if (error.response?.status === 429) {
          this.stats.rateLimited++;
          console.log(`🚫 Worker ${workerId} rate limited, waiting 60s...`);
          await new Promise(resolve => setTimeout(resolve, 60000));
          retries--;
        } else if (error.response?.status === 404) {
          // Token not found, skip it
          return false;
        } else {
          throw error;
        }
      }
    }
    
    return false;
  }

  stop() {
    this.scanning = false;
    console.log('\nStopping scanner...');
  }
}

// Try DexScreener as backup for rate-limited tokens
async function tryDexScreener(address) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 5000 }
    );
    
    if (response.data?.pairs?.length > 0) {
      const pair = response.data.pairs[0];
      return {
        marketCap: parseFloat(pair.fdv || '0'),
        liquidity: parseFloat(pair.liquidity?.usd || '0'),
        volume24h: parseFloat(pair.volume?.h24 || '0')
      };
    }
  } catch (error) {
    // Ignore
  }
  return null;
}

// Run the scanner
const scanner = new RateLimitedScanner({
  concurrency: 5, // Safe for most API plans
  requestsPerMinute: 30 // Adjust based on your Birdeye plan
});

// Graceful shutdown
process.on('SIGINT', () => {
  scanner.stop();
  setTimeout(() => process.exit(0), 2000);
});

// Show initial stats
pool.query(`
  SELECT category, COUNT(*) as count
  FROM tokens
  WHERE category != 'BIN'
  GROUP BY category
`).then(result => {
  console.log('\n📊 Initial distribution:');
  console.table(result.rows);
  console.log('\n');
  
  scanner.start().catch(console.error);
});