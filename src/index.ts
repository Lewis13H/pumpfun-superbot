// src/index.ts
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './database/postgres';

async function startApplication() {
  logger.info('🚀 Starting Memecoin Bot with gRPC Streaming...');
  
  try {
    await db.raw('SELECT NOW()');
    logger.info('✅ Database connected');
    
    const { GrpcStreamApplication } = await import('./grpc/grpc-stream-app');
    const grpcApp = new GrpcStreamApplication();
    await grpcApp.start();
    
    logger.info('✅ gRPC streaming system started');
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

startApplication();