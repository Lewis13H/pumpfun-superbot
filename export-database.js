// export-entire-database.js
// Exports ENTIRE database to Excel - every table, every column, every row

require('dotenv').config();
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs').promises;

// Database configuration
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433'),
  database: process.env.POSTGRES_DB || 'memecoin_discovery',
  user: process.env.POSTGRES_USER || 'memecoin_user',
  password: process.env.POSTGRES_PASSWORD,
  max: 5,
});

class CompleteDatabaseExporter {
  constructor() {
    this.workbook = new ExcelJS.Workbook();
    this.exportPath = path.join(__dirname, 'exports');
    this.totalRows = 0;
    this.totalTables = 0;
  }

  async initialize() {
    // Create export directory
    await fs.mkdir(this.exportPath, { recursive: true });
    
    // Set workbook properties
    this.workbook.creator = 'Database Exporter';
    this.workbook.created = new Date();
    this.workbook.modified = new Date();
    this.workbook.properties.date1904 = true;
    
    console.log('🚀 Complete Database Export Started');
    console.log('=' .repeat(60));
  }

  // Format worksheet with auto-sizing and styling
  formatWorksheet(worksheet) {
    if (worksheet.rowCount === 0) return;
    
    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    // Auto-fit columns (with reasonable limits)
    worksheet.columns.forEach(column => {
      let maxLength = 10;
      column.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber === 1) { // Header
          maxLength = Math.max(maxLength, cell.value ? cell.value.toString().length : 10);
        } else {
          // Sample first 100 rows for column width
          if (rowNumber <= 100) {
            const cellLength = cell.value ? cell.value.toString().length : 0;
            maxLength = Math.max(maxLength, Math.min(cellLength, 50)); // Cap at 50
          }
        }
      });
      column.width = Math.min(maxLength + 2, 50); // Max width 50
    });
    
    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // Get all tables from specified schemas
  async getAllTables() {
    const result = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables
      WHERE schemaname IN ('public', 'timeseries')
      ORDER BY schemaname, tablename
    `);
    
    return result.rows;
  }

  // Export a single table dynamically
  async exportTable(schema, tableName) {
    console.log(`\n📊 Exporting ${schema}.${tableName}...`);
    
    try {
      // Get row count first
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM ${schema}.${tableName}`
      );
      const rowCount = parseInt(countResult.rows[0].count);
      
      if (rowCount === 0) {
        console.log(`   ⚠️  Skipping (empty table)`);
        return;
      }
      
      console.log(`   📝 Rows to export: ${rowCount.toLocaleString()}`);
      
      // Create worksheet with truncated name if necessary (Excel limit is 31 chars)
      const sheetName = tableName.length > 31 ? tableName.substring(0, 31) : tableName;
      const worksheet = this.workbook.addWorksheet(sheetName);
      
      // For very large tables, export in chunks
      const CHUNK_SIZE = 50000;
      let offset = 0;
      let firstChunk = true;
      
      while (offset < rowCount) {
        // Get chunk of data
        const query = `
          SELECT * 
          FROM ${schema}.${tableName}
          ORDER BY 1
          LIMIT ${CHUNK_SIZE}
          OFFSET ${offset}
        `;
        
        const result = await pool.query(query);
        
        if (result.rows.length === 0) break;
        
        // Add headers on first chunk
        if (firstChunk) {
          const headers = Object.keys(result.rows[0]);
          worksheet.addRow(headers);
          console.log(`   📋 Columns: ${headers.length}`);
          firstChunk = false;
        }
        
        // Add data rows
        result.rows.forEach(row => {
          const values = Object.values(row).map(value => {
            // Handle special data types
            if (value === null) return '';
            if (value instanceof Date) return value;
            if (typeof value === 'object') return JSON.stringify(value);
            if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
            // Handle BigInt
            if (typeof value === 'bigint') return value.toString();
            // Handle numeric/decimal types
            if (value && value.toString && value.toString().length > 15) {
              return value.toString();
            }
            return value;
          });
          worksheet.addRow(values);
        });
        
        offset += CHUNK_SIZE;
        
        // Progress indicator for large tables
        if (rowCount > CHUNK_SIZE) {
          const progress = Math.min(100, Math.round((offset / rowCount) * 100));
          process.stdout.write(`\r   ⏳ Progress: ${progress}%`);
        }
      }
      
      // Format the worksheet
      this.formatWorksheet(worksheet);
      
      // Update counters
      this.totalRows += rowCount;
      this.totalTables += 1;
      
      console.log(`\n   ✅ Exported ${rowCount.toLocaleString()} rows`);
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      
      // Still create a worksheet with error message
      const sheetName = tableName.length > 31 ? tableName.substring(0, 31) : tableName;
      const worksheet = this.workbook.addWorksheet(sheetName);
      worksheet.addRow(['Error exporting table']);
      worksheet.addRow([error.message]);
    }
  }

  // Create summary sheet
  async createSummarySheet(tables) {
    console.log('\n📋 Creating summary sheet...');
    
    const worksheet = this.workbook.addWorksheet('_Summary', { position: 0 });
    
    // Title
    worksheet.addRow(['Database Export Summary']);
    worksheet.addRow(['']);
    worksheet.addRow(['Export Date:', new Date().toLocaleString()]);
    worksheet.addRow(['Database:', process.env.POSTGRES_DB || 'memecoin_discovery']);
    worksheet.addRow(['Total Tables:', this.totalTables]);
    worksheet.addRow(['Total Rows Exported:', this.totalRows.toLocaleString()]);
    worksheet.addRow(['']);
    
    // Table list
    worksheet.addRow(['Tables Exported:']);
    worksheet.addRow(['Schema', 'Table Name', 'Size on Disk']);
    
    for (const table of tables) {
      // Get row count
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*) as count FROM ${table.schemaname}.${table.tablename}`
        );
        const count = countResult.rows[0].count;
        worksheet.addRow([
          table.schemaname,
          table.tablename,
          table.size,
          `${parseInt(count).toLocaleString()} rows`
        ]);
      } catch (e) {
        worksheet.addRow([table.schemaname, table.tablename, table.size, 'Error']);
      }
    }
    
    // Format summary sheet
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 40;
    worksheet.getColumn(3).width = 15;
    worksheet.getColumn(4).width = 20;
    
    // Style the header rows
    worksheet.getRow(1).font = { bold: true, size: 16 };
    worksheet.getRow(9).font = { bold: true };
    
    console.log('✅ Summary sheet created');
  }

  // Main export function
  async exportAll() {
    try {
      await this.initialize();
      
      // Get all tables
      const tables = await this.getAllTables();
      console.log(`\n📊 Found ${tables.length} tables to export`);
      
      // Export each table
      for (const table of tables) {
        await this.exportTable(table.schemaname, table.tablename);
      }
      
      // Create summary sheet
      await this.createSummarySheet(tables);
      
      // Save the workbook
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `complete_database_export_${timestamp}.xlsx`;
      const filepath = path.join(this.exportPath, filename);
      
      console.log('\n💾 Saving Excel file...');
      await this.workbook.xlsx.writeFile(filepath);
      
      // Get file size
      const stats = await fs.stat(filepath);
      const fileSizeInMB = (stats.size / 1024 / 1024).toFixed(2);
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ EXPORT COMPLETE!');
      console.log('='.repeat(60));
      console.log(`📄 File: ${filepath}`);
      console.log(`📊 Size: ${fileSizeInMB} MB`);
      console.log(`📋 Tables: ${this.totalTables}`);
      console.log(`📝 Total Rows: ${this.totalRows.toLocaleString()}`);
      console.log('='.repeat(60));
      
      return filepath;
      
    } catch (error) {
      console.error('\n❌ Export failed:', error);
      throw error;
    } finally {
      await pool.end();
    }
  }
}

// Alternative: Export as multiple CSV files (if Excel becomes too large)
class CSVExporter {
  constructor() {
    this.exportPath = path.join(__dirname, 'csv_exports');
  }

  async exportAllAsCSV() {
    await fs.mkdir(this.exportPath, { recursive: true });
    
    const tables = await this.getAllTables();
    console.log(`🎯 Exporting ${tables.length} tables as CSV files...\n`);
    
    for (const table of tables) {
      await this.exportTableAsCSV(table.schemaname, table.tablename);
    }
    
    console.log('\n✅ CSV export complete!');
    console.log(`📁 Files saved to: ${this.exportPath}`);
  }

  async getAllTables() {
    const result = await pool.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname IN ('public', 'timeseries')
      ORDER BY schemaname, tablename
    `);
    return result.rows;
  }

  async exportTableAsCSV(schema, tableName) {
    const filename = `${schema}_${tableName}.csv`;
    const filepath = path.join(this.exportPath, filename);
    
    console.log(`Exporting ${schema}.${tableName} to CSV...`);
    
    const copyQuery = `COPY (SELECT * FROM ${schema}.${tableName}) TO STDOUT WITH CSV HEADER`;
    
    try {
      const client = await pool.connect();
      const stream = client.query(copyQuery);
      const fileStream = require('fs').createWriteStream(filepath);
      
      stream.pipe(fileStream);
      
      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        stream.on('error', reject);
      });
      
      client.release();
      console.log(`✅ Exported ${filename}`);
    } catch (error) {
      console.log(`❌ Failed to export ${filename}: ${error.message}`);
    }
  }
}

// Run the export
if (require.main === module) {
  // Check command line argument
  const exportType = process.argv[2];
  
  if (exportType === '--csv') {
    // Export as CSV files
    const csvExporter = new CSVExporter();
    csvExporter.exportAllAsCSV()
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  } else {
    // Default: Export as Excel
    const exporter = new CompleteDatabaseExporter();
    exporter.exportAll()
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  }
}

module.exports = { CompleteDatabaseExporter, CSVExporter };