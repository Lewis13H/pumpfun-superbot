// src/config/index.ts

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  // Database
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  DB_POOL_MAX: number;
  
  // gRPC Configuration
  GRPC_ENDPOINT: string;
  GRPC_TOKEN: string;
  GRPC_BATCH_SIZE: number;
  GRPC_FLUSH_INTERVAL: number;
  
  // RPC & APIs (for enriched data)
  HELIUS_RPC_URL: string;
  SOLSNIFFER_API_KEY?: string;
  BIRDEYE_API_KEY?: string;
  COINGECKO_API_KEY?: string;
  
  // API object for backward compatibility
  apis: {
    solsnifferApiKey?: string;
    birdeyeApiKey?: string;
    heliusRpcUrl: string;
    moralisApiKey?: string;
  };
  
  // Category Thresholds
  CATEGORY_LOW_MAX: number;
  CATEGORY_MEDIUM_MAX: number;
  CATEGORY_HIGH_MAX: number;
  CATEGORY_AIM_MIN: number;
  CATEGORY_AIM_MAX: number;
  
  // Performance
  PRICE_CHANGE_INTERVAL: number;
  
  // Features
  DISABLE_SOLSNIFFER: boolean;
  ENABLE_TRADING: boolean;
  WEBSOCKET_ENABLED: boolean;
  WEBSOCKET_PORT: number;
  
  // Price Data
  SOL_PRICE_USD: number;
  
  // Logging
  LOG_LEVEL: string;
  LOG_TO_FILE: boolean;
}

// Helper function to ensure URL has protocol
function ensureProtocol(url: string): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (trimmed.includes('://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export const config: Config = {
  // Database Configuration
  POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
  POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT || '5433'),
  POSTGRES_USER: process.env.POSTGRES_USER || 'memecoin_user',
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || '',
  POSTGRES_DB: process.env.POSTGRES_DB || 'memecoin_discovery',
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX || '20'),
  
  // gRPC Configuration - ensure endpoint has protocol
  GRPC_ENDPOINT: ensureProtocol(process.env.GRPC_ENDPOINT || 'grpc.ams.shyft.to'),
  GRPC_TOKEN: process.env.GRPC_TOKEN || '',
  GRPC_BATCH_SIZE: parseInt(process.env.GRPC_BATCH_SIZE || '1000'),
  GRPC_FLUSH_INTERVAL: parseInt(process.env.GRPC_FLUSH_INTERVAL || '1000'),
  
  // RPC & APIs
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL || '',
  SOLSNIFFER_API_KEY: process.env.SOLSNIFFER_API_KEY,
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY,
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
  
  // API object for backward compatibility
  apis: {
    solsnifferApiKey: process.env.SOLSNIFFER_API_KEY,
    birdeyeApiKey: process.env.BIRDEYE_API_KEY,
    heliusRpcUrl: process.env.HELIUS_RPC_URL || '',
    moralisApiKey: process.env.MORALIS_API_KEY,
  },
  
  // Category Thresholds
  CATEGORY_LOW_MAX: parseInt(process.env.CATEGORY_LOW_MAX || '8000'),
  CATEGORY_MEDIUM_MAX: parseInt(process.env.CATEGORY_MEDIUM_MAX || '19000'),
  CATEGORY_HIGH_MAX: parseInt(process.env.CATEGORY_HIGH_MAX || '35000'),
  CATEGORY_AIM_MIN: parseInt(process.env.CATEGORY_AIM_MIN || '35000'),
  CATEGORY_AIM_MAX: parseInt(process.env.CATEGORY_AIM_MAX || '105000'),
  
  // Performance
  PRICE_CHANGE_INTERVAL: parseInt(process.env.PRICE_CHANGE_INTERVAL || '300000'), // 5 minutes
  
  // Features
  DISABLE_SOLSNIFFER: process.env.DISABLE_SOLSNIFFER === 'true',
  ENABLE_TRADING: process.env.ENABLE_TRADING !== 'false', // Default true
  WEBSOCKET_ENABLED: process.env.WEBSOCKET_ENABLED === 'true',
  WEBSOCKET_PORT: parseInt(process.env.WEBSOCKET_PORT || '8080'),
  
  // Price Data
  SOL_PRICE_USD: parseFloat(process.env.SOL_PRICE_USD || '100'),
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_TO_FILE: process.env.LOG_TO_FILE !== 'false' // Default true
};

// Validate configuration
export function validateConfig(): void {
  const required: (keyof Config)[] = [
    'POSTGRES_PASSWORD',
    'HELIUS_RPC_URL'
  ];
  
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
  
  // Validate thresholds are in order
  if (config.CATEGORY_LOW_MAX >= config.CATEGORY_MEDIUM_MAX ||
      config.CATEGORY_MEDIUM_MAX >= config.CATEGORY_HIGH_MAX ||
      config.CATEGORY_HIGH_MAX >= config.CATEGORY_AIM_MIN ||
      config.CATEGORY_AIM_MIN >= config.CATEGORY_AIM_MAX) {
    throw new Error('Category thresholds must be in ascending order');
  }
  
  // Log the gRPC endpoint being used
  console.log(`Using gRPC endpoint: ${config.GRPC_ENDPOINT}`);
}