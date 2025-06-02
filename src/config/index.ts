import * as dotenv from 'dotenv';
import * as Joi from 'joi';
import * as path from 'path';

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

  // PumpFun specific
  PUMPFUN_WS_URL: Joi.string().default('wss://pumpportal.fun/api/data'),
  PUMPFUN_API_URL: Joi.string().default('https://frontend-api.pump.fun'),
  PUMPFUN_PRIMARY_METHOD: Joi.string().valid('logs', 'blocks', 'websocket').default('logs'),
  PUMPFUN_MIN_LIQUIDITY: Joi.number().default(0.1),
  PUMPFUN_MIN_HOLDERS: Joi.number().default(10),
  PUMPFUN_MAX_TOKEN_AGE: Joi.number().default(300), // 5 minutes
  PUMPFUN_MAX_CREATOR_TOKENS_DAILY: Joi.number().default(5),
  PUMPFUN_MIN_CREATOR_REPUTATION: Joi.number().min(0).max(1).default(0.5),
  
  // Discovery
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
    rateLimit: {
      maxRequestsPerMinute: 30,
      retryDelays: [1000, 2000, 4000], // milliseconds
    }  
  },

  discovery: {
    pumpfunWsUrl: envVars.PUMPFUN_WS_URL,
    pumpfunApiUrl: envVars.PUMPFUN_API_URL,
    raydiumProgramId: envVars.RAYDIUM_PROGRAM_ID,
    maxConcurrentProcessing: envVars.MAX_CONCURRENT_PROCESSING,
    discoveryQueueSize: envVars.DISCOVERY_QUEUE_SIZE,
    
    // PumpFun enhanced settings
    pumpfun: {
      // WebSocket endpoints to try in order
      wsEndpoints: [
        envVars.PUMPFUN_WS_URL,
        'wss://frontend-api.pump.fun/ws',
      ],
      
      // Monitoring preferences
      primaryMethod: envVars.PUMPFUN_PRIMARY_METHOD,
      enableFallback: true,
      
      // Discovery filters
      minLiquidity: envVars.PUMPFUN_MIN_LIQUIDITY,
      minHolders: envVars.PUMPFUN_MIN_HOLDERS,
      maxTokenAge: envVars.PUMPFUN_MAX_TOKEN_AGE,
      
      // Bonding curve constants
      raydiumMigrationThreshold: 69420, // SOL required for migration
      tokenDecimals: 6, // pump.fun uses 6 decimals
      
      // Creator filtering
      maxCreatorTokensPerDay: envVars.PUMPFUN_MAX_CREATOR_TOKENS_DAILY,
      minCreatorReputation: envVars.PUMPFUN_MIN_CREATOR_REPUTATION,
      blacklistedCreators: [], // Can be loaded from DB or env
      
      // Performance tuning
      curveDataCacheTTL: 30000, // 30 seconds
      maxRetries: 3,
      retryDelay: 1000,
    },
  },
  
  // Analysis configuration with pump.fun enhancements
  analysis: {
    // Standard weights
    weights: {
      safety: 0.3,
      liquidity: 0.25,
      community: 0.2,
      momentum: 0.15,
      potential: 0.1,
    },
    
    // PumpFun specific analysis weights
    pumpfunWeights: {
      curveHealth: 0.2,
      migrationPotential: 0.15,
      creatorReputation: 0.15,
      initialLiquidity: 0.25,
      priceStability: 0.25,
    },
    
    // Classification thresholds
    thresholds: {
      strongBuy: 0.8,
      buy: 0.65,
      consider: 0.5,
      monitor: 0.35,
      avoid: 0.2,
    },
    
    // PumpFun specific thresholds
    pumpfunThresholds: {
      minCurveProgress: 5, // Minimum % progress to consider
      healthyReserveRatio: 0.8, // Virtual/real reserves ratio
      suspiciousVolumeSpike: 10, // 10x average volume
      rugPullLiquidityDrop: 0.5, // 50% liquidity drop
    },
  },
  
  // System paths
  paths: {
    idl: path.join(__dirname, '../../idl'),
    data: path.join(__dirname, '../../data'),
    logs: path.join(__dirname, '../../logs'),
    cache: path.join(__dirname, '../../cache'),
  },
};

// Export types for better IDE support
export type Config = typeof config;
export type PumpFunConfig = typeof config.discovery.pumpfun;
export type AnalysisConfig = typeof config.analysis;
