// inspect-database.js
// Quick script to check database structure before exporting

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433'),
  database: process.env.POSTGRES_DB || 'memecoin_discovery',
  user: process.env.POSTGRES_USER || 'memecoin_user',
  password: process.env.POSTGRES_PASSWORD,
  max: 1,
});

async function inspectDatabase() {
  try {
    console.log('🔍 Inspecting Database Structure\n');
    
    // Check connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully\n');
    
    // Get all schemas
    const schemas = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schema_name
    `);
    
    console.log('📋 Available Schemas:');
    schemas.rows.forEach(row => console.log(`  - ${row.schema_name}`));
    console.log();
    
    // Get all tables with row counts
    console.log('📊 Tables and Row Counts:');
    console.log('========================\n');
    
    for (const schema of ['public', 'timeseries']) {
      console.log(`Schema: ${schema}`);
      console.log('-'.repeat(50));
      
      const tables = await pool.query(`
        SELECT 
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables
        WHERE schemaname = $1
        ORDER BY tablename
      `, [schema]);
      
      for (const table of tables.rows) {
        try {
          const countResult = await pool.query(
            `SELECT COUNT(*) as count FROM ${schema}.${table.tablename}`
          );
          const count = countResult.rows[0].count;
          
          console.log(`  ${table.tablename}:`);
          console.log(`    Rows: ${parseInt(count).toLocaleString()}`);
          console.log(`    Size: ${table.size}`);
          
          // Get columns for each table
          const columns = await pool.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            LIMIT 10
          `, [schema, table.tablename]);
          
          console.log(`    Columns (first 10): ${columns.rows.map(c => c.column_name).join(', ')}`);
          if (columns.rows.length === 10) {
            const totalCols = await pool.query(`
              SELECT COUNT(*) as count
              FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2
            `, [schema, table.tablename]);
            console.log(`    ... and ${totalCols.rows[0].count - 10} more columns`);
          }
          console.log();
        } catch (e) {
          console.log(`  ${table.tablename}: Error reading table`);
        }
      }
      console.log();
    }
    
    // Check for TimescaleDB
    try {
      const tsCheck = await pool.query(`
        SELECT default_version, installed_version 
        FROM pg_available_extensions 
        WHERE name = 'timescaledb'
      `);
      
      if (tsCheck.rows[0]?.installed_version) {
        console.log('⏰ TimescaleDB Status:');
        console.log(`  Version: ${tsCheck.rows[0].installed_version}`);
        
        // Get hypertables
        const hypertables = await pool.query(`
          SELECT 
            schema_name,
            table_name,
            pg_size_pretty(total_bytes) as total_size,
            pg_size_pretty(compressed_bytes) as compressed_size
          FROM timescaledb_information.hypertables
        `);
        
        if (hypertables.rows.length > 0) {
          console.log('\n  Hypertables:');
          hypertables.rows.forEach(ht => {
            console.log(`    ${ht.schema_name}.${ht.table_name}`);
            console.log(`      Total: ${ht.total_size}, Compressed: ${ht.compressed_size || 'Not compressed'}`);
          });
        }
      }
    } catch (e) {
      console.log('⚠️ TimescaleDB not installed or accessible');
    }
    
    // Sample data from tokens table
    console.log('\n📝 Sample Token Data:');
    console.log('===================\n');
    
    try {
      const tokenSample = await pool.query(`
        SELECT address, symbol, name, category, market_cap
        FROM public.tokens
        WHERE market_cap IS NOT NULL
        ORDER BY market_cap DESC
        LIMIT 5
      `);
      
      if (tokenSample.rows.length > 0) {
        console.log('Top 5 tokens by market cap:');
        tokenSample.rows.forEach((token, i) => {
          console.log(`  ${i + 1}. ${token.symbol || 'N/A'} (${token.name || 'N/A'})`);
          console.log(`     Category: ${token.category}, Market Cap: $${parseFloat(token.market_cap).toLocaleString()}`);
        });
      } else {
        console.log('No tokens with market cap data found');
      }
    } catch (e) {
      console.log('Error reading token data:', e.message);
    }
    
  } catch (error) {
    console.error('❌ Inspection failed:', error.message);
  } finally {
    await pool.end();
  }
}

// Run inspection
inspectDatabase();