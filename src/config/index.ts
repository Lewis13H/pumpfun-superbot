import dotenv from 'dotenv';
import Joi from 'joi';
import path from 'path';

dotenv.config();

const envSchema = Joi.object({
  // Database
  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  
  QUESTDB_HOST: Joi.string().required(),
  QUESTDB_HTTP_PORT: Joi.number().default(9000),
  QUESTDB_PG_PORT: Joi.number().default(8812),
  QUESTDB_ILP_PORT: Joi.number().default(9009),
  
  // API Keys
  HELIUS_RPC_URL: Joi.string().required(),
  SOLSNIFFER_API_KEY: Joi.string().required(),
  BIRDEYE_API_KEY: Joi.string().required(),
  MORALIS_API_KEY: Joi.string().required(),

  //validation schema
  PUMPFUN_WS_URL: Joi.string().default('wss://pumpportal.fun/api/data'),
  PUMPFUN_API_URL: Joi.string().default('https://frontend-api.pump.fun'),
  RAYDIUM_PROGRAM_ID: Joi.string().default('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
  MAX_CONCURRENT_PROCESSING: Joi.number().default(10),
  DISCOVERY_QUEUE_SIZE: Joi.number().default(1000),
  
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
}).unknown();

const { value: envVars, error } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  logLevel: envVars.LOG_LEVEL,
  
  postgres: {
    host: envVars.POSTGRES_HOST,
    port: envVars.POSTGRES_PORT,
    user: envVars.POSTGRES_USER,
    password: envVars.POSTGRES_PASSWORD,
    database: envVars.POSTGRES_DB,
  },
  
  questdb: {
    host: envVars.QUESTDB_HOST,
    httpPort: envVars.QUESTDB_HTTP_PORT,
    pgPort: envVars.QUESTDB_PG_PORT,
    ilpPort: envVars.QUESTDB_ILP_PORT,
  },
  
  apis: {
    heliusRpcUrl: envVars.HELIUS_RPC_URL,
    solsnifferApiKey: envVars.SOLSNIFFER_API_KEY,
    birdeyeApiKey: envVars.BIRDEYE_API_KEY,
    moralisApiKey: envVars.MORALIS_API_KEY,
  },

  discovery: {
  pumpfunWsUrl: envVars.PUMPFUN_WS_URL,
  pumpfunApiUrl: envVars.PUMPFUN_API_URL,
  raydiumProgramId: envVars.RAYDIUM_PROGRAM_ID,
  maxConcurrentProcessing: envVars.MAX_CONCURRENT_PROCESSING,
  discoveryQueueSize: envVars.DISCOVERY_QUEUE_SIZE,
  },
};