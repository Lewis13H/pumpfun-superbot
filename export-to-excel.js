const fs = require('fs');
const { parse } = require('json2csv');
const knex = require('knex');

// Database connection
const db = knex({
    client: 'pg',
    connection: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5433'),
        database: process.env.POSTGRES_DB || 'memecoin_discovery',
        user: process.env.POSTGRES_USER || 'memecoin_user',
        password: process.env.POSTGRES_PASSWORD,
    }
});

async function exportTableToCSV(tableName, schema = 'public') {
    try {
        // Get all data from table
        const data = await db(`${schema}.${tableName}`).select('*');
        
        if (data.length === 0) {
            console.log(`No data found in ${schema}.${tableName}`);
            return;
        }

        // Convert to CSV
        const csv = parse(data);
        
        // Write to file
        const filename = `${tableName}_export_${new Date().toISOString().split('T')[0]}.csv`;
        fs.writeFileSync(filename, csv);
        
        console.log(`✅ Exported ${data.length} rows to ${filename}`);
    } catch (error) {
        console.error(`Error exporting ${tableName}:`, error);
    }
}

async function exportAllTables() {
    // Export main tables
    await exportTableToCSV('tokens', 'public');
    await exportTableToCSV('token_signals', 'public');
    await exportTableToCSV('category_transitions', 'public');
    
    // Export time-series tables (last 24 hours only to manage size)
    const recentPrices = await db('timeseries.token_prices')
        .select('*')
        .where('time', '>', db.raw("NOW() - INTERVAL '24 hours'"));
    
    if (recentPrices.length > 0) {
        const csv = parse(recentPrices);
        fs.writeFileSync('token_prices_24h.csv', csv);
        console.log(`✅ Exported ${recentPrices.length} price records`);
    }
    
    await db.destroy();
}

// Run export
exportAllTables();