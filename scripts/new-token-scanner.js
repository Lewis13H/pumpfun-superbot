// scripts/new-token-scanner.js
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

class NewTokenScanner {
  constructor() {
    this.running = false;
    this.stats = {
      scans: 0,
      promotions: 0,
      timeouts: 0,
      errors: 0,
      startTime: Date.now()
    };
    this.scanInterval = 60000; // 1 minute between full scans
    this.tokenScanDelay = 1000; // 1 second between tokens
  }

  async start() {
    console.log('🔍 Starting dedicated NEW token scanner...\n');
    this.running = true;
    
    while (this.running) {
      await this.scanCycle();
      await this.showStats();
      
      console.log(`\n⏳ Next scan in ${this.scanInterval/1000} seconds...\n`);
      await new Promise(resolve => setTimeout(resolve, this.scanInterval));
    }
  }

  async scanCycle() {
    try {
      // First, handle timeouts
      const timeouts = await pool.query(`
        UPDATE tokens
        SET 
          category = 'LOW',
          category_updated_at = NOW()
        WHERE category = 'NEW'
          AND created_at < NOW() - INTERVAL '30 minutes'
          AND market_cap < 8000
        RETURNING symbol, market_cap
      `);
      
      if (timeouts.rowCount > 0) {
        console.log(`⏰ Timed out ${timeouts.rowCount} tokens to LOW`);
        this.stats.timeouts += timeouts.rowCount;
        
        // Log transitions
        for (const token of timeouts.rows) {
          await pool.query(`
            INSERT INTO category_transitions 
            (token_address, from_category, to_category, market_cap_at_transition, reason, created_at)
            SELECT address, 'NEW', 'LOW', $2, 'Timeout - no growth', NOW()
            FROM tokens WHERE symbol = $1
          `, [token.symbol, token.market_cap]);
        }
      }
      
      // Get NEW tokens to scan (prioritize unscanned and older tokens)
      const tokens = await pool.query(`
        SELECT 
          address, 
          symbol, 
          market_cap,
          created_at,
          last_scan_at,
          category_scan_count
        FROM tokens
        WHERE category = 'NEW'
        ORDER BY 
          last_scan_at ASC NULLS FIRST,
          created_at ASC
        LIMIT 50
      `);
      
      console.log(`\n📊 Scanning ${tokens.rows.length} NEW tokens...`);
      
      for (const token of tokens.rows) {
        await this.scanToken(token);
        this.stats.scans++;
        await new Promise(resolve => setTimeout(resolve, this.tokenScanDelay));
      }
      
    } catch (error) {
      console.error('Scan cycle error:', error);
      this.stats.errors++;
    }
  }

  async scanToken(token) {
    try {
      // Try Birdeye first
      let marketData = await this.fetchBirdeye(token.address);
      
      // Fallback to DexScreener if Birdeye fails
      if (!marketData && token.category_scan_count > 2) {
        marketData = await this.fetchDexScreener(token.address);
      }
      
      if (!marketData) {
        // Just update scan timestamp
        await pool.query(`
          UPDATE tokens 
          SET last_scan_at = NOW(), category_scan_count = category_scan_count + 1
          WHERE address = $1
        `, [token.address]);
        return;
      }
      
      // Update token data
      const oldMc = token.market_cap;
      await pool.query(`
        UPDATE tokens 
        SET 
          market_cap = $1,
          liquidity = $2,
          holders = $3,
          volume_24h = $4,
          last_scan_at = NOW(),
          category_scan_count = category_scan_count + 1,
          updated_at = NOW()
        WHERE address = $5
      `, [
        marketData.marketCap,
        marketData.liquidity || 0,
        marketData.holders || null,
        marketData.volume24h || 0,
        token.address
      ]);
      
      // Log scan
      await pool.query(`
        INSERT INTO scan_logs 
        (token_address, category, scan_number, scan_duration_ms, apis_called, created_at)
        VALUES ($1, 'NEW', $2, 100, $3, NOW())
      `, [
        token.address,
        token.category_scan_count + 1,
        JSON.stringify([marketData.source])
      ]);
      
      // Check if promoted
      if (marketData.marketCap >= 8000 && oldMc < 8000) {
        const age = Math.floor((Date.now() - new Date(token.created_at).getTime()) / 60000);
        console.log(`\n🚀 ${token.symbol} PROMOTED! $${oldMc} → $${marketData.marketCap} (${age}min old)`);
        this.stats.promotions++;
      }
      
    } catch (error) {
      console.error(`Error scanning ${token.symbol}:`, error.message);
      this.stats.errors++;
    }
  }

  async fetchBirdeye(address) {
    try {
      const response = await axios.get(
        `https://public-api.birdeye.so/defi/token_overview?address=${address}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-API-KEY': process.env.BIRDEYE_API_KEY
          },
          timeout: 5000
        }
      );
      
      if (response.data?.data) {
        return {
          marketCap: response.data.data.marketCap || 0,
          liquidity: response.data.data.liquidity || 0,
          holders: response.data.data.holder || 0,
          volume24h: response.data.data.v24hUSD || 0,
          source: 'birdeye'
        };
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }
    return null;
  }

  async fetchDexScreener(address) {
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
          volume24h: parseFloat(pair.volume?.h24 || '0'),
          source: 'dexscreener'
        };
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  async showStats() {
    const summary = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN last_scan_at IS NOT NULL THEN 1 END) as scanned,
        COUNT(CASE WHEN market_cap >= 8000 THEN 1 END) as ready_for_promotion,
        COUNT(CASE WHEN created_at < NOW() - INTERVAL '30 minutes' AND market_cap < 8000 THEN 1 END) as ready_for_timeout,
        AVG(category_scan_count) as avg_scans
      FROM tokens
      WHERE category = 'NEW'
    `);
    
    const runtime = Math.floor((Date.now() - this.stats.startTime) / 60000);
    
    console.log(`\n📈 Scanner Stats (${runtime} min runtime):`);
    console.log(`   Total scans: ${this.stats.scans}`);
    console.log(`   Promotions: ${this.stats.promotions}`);
    console.log(`   Timeouts: ${this.stats.timeouts}`);
    console.log(`   Errors: ${this.stats.errors}`);
    console.log(`\n📊 NEW Token Status:`);
    console.log(`   Total: ${summary.rows[0].total}`);
    console.log(`   Scanned: ${summary.rows[0].scanned}`);
    console.log(`   Ready for promotion: ${summary.rows[0].ready_for_promotion}`);
    console.log(`   Ready for timeout: ${summary.rows[0].ready_for_timeout}`);
    console.log(`   Avg scans per token: ${parseFloat(summary.rows[0].avg_scans).toFixed(1)}`);
  }

  stop() {
    this.running = false;
    console.log('\nStopping scanner...');
  }
}

// Start scanner
const scanner = new NewTokenScanner();

process.on('SIGINT', () => {
  scanner.stop();
  setTimeout(() => process.exit(0), 1000);
});

scanner.start().catch(console.error);