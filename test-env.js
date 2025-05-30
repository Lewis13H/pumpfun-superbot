require('dotenv').config();
console.log('POSTGRES_USER:', process.env.POSTGRES_USER);
console.log('POSTGRES_PASSWORD:', process.env.POSTGRES_PASSWORD);
console.log('POSTGRES_PASSWORD length:', process.env.POSTGRES_PASSWORD?.length);
console.log('POSTGRES_DB:', process.env.POSTGRES_DB);
console.log('POSTGRES_PORT:', process.env.POSTGRES_PORT);
