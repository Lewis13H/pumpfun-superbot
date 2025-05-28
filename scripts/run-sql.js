const { db } = require('../src/database/postgres');
const fs = require('fs');

const sql = fs.readFileSync('./scripts/fix-final-columns.sql', 'utf8');

db.raw(sql)
  .then(() => {
    console.log('Schema updated successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });