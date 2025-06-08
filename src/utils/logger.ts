// Create or update your src/utils/logger.ts file with this cleaner configuration

import winston from 'winston';

// Custom format for clean terminal output
const cleanFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Clean message formatting
    let formattedMessage = message;
    
    // Format objects nicely
    if (typeof meta === 'object' && Object.keys(meta).length > 0) {
      const metaStr = Object.entries(meta)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      formattedMessage += ` ${metaStr}`;
    }
    
    return `${timestamp} ${level}: ${formattedMessage}`;
  })
);

// Create logger with clean configuration
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // Change to 'warn' to reduce output further
  format: cleanFormat,
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    }),
    // Optional: Save to file for debugging
    new winston.transports.File({ 
      filename: 'logs/bot.log',
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5
    })
  ],
  exitOnError: false
});

// Add methods for clean terminal output
export const terminal = {
  clear: () => console.clear(),
  
  header: (title: string) => {
    console.log('\n' + '='.repeat(60));
    console.log(`🚀 ${title}`);
    console.log('='.repeat(60));
  },
  
  section: (title: string) => {
    console.log(`\n📊 ${title}`);
    console.log('-'.repeat(40));
  },
  
  newToken: (symbol: string, name: string, address: string, marketCap?: number) => {
    const mc = marketCap ? `$${marketCap.toFixed(0)}` : 'Unknown MC';
    console.log(`🎉 NEW: ${symbol} (${name}) | ${mc} | ${address.substring(0, 8)}...`);
  },
  
  priceUpdate: (symbol: string, price: number, marketCap: number, address: string) => {
    console.log(`💰 ${symbol} | $${marketCap.toFixed(0)} MC | $${price.toFixed(6)} | ${address.substring(0, 8)}...`);
  },
  
  category: (symbol: string, from: string, to: string, marketCap: number) => {
    console.log(`📊 ${symbol}: ${from} → ${to} ($${marketCap.toFixed(0)})`);
  },
  
  buySignal: (symbol: string, reason: string, address: string) => {
    console.log(`🚨 BUY SIGNAL: ${symbol} | ${reason} | ${address.substring(0, 8)}...`);
  },
  
  graduation: (symbol: string, progress: number) => {
    console.log(`🎓 GRADUATION: ${symbol} ${progress.toFixed(1)}% complete`);
  },
  
  trade: (type: 'BUY' | 'SELL', amount: number, address: string) => {
    const emoji = type === 'BUY' ? '🟢' : '🔴';
    console.log(`${emoji} ${type}: ${amount.toFixed(2)} SOL | ${address.substring(0, 8)}...`);
  },
  
  stats: (stats: any) => {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PUMP.FUN BOT STATUS');
    console.log('='.repeat(60));
    console.log(`📈 Processed: ${stats.pricesProcessed} prices | ${stats.newTokensDiscovered} new tokens`);
    console.log(`💰 Activity: ${stats.buysDetected} buys | ${stats.sellsDetected} sells`);
    console.log(`🔍 Metadata: ${stats.metadataFound} extracted | ${stats.metadataExtractionFailures} failed`);
    console.log(`🔄 Buffers: ${stats.bufferSizes?.prices || 0} prices | ${stats.bufferSizes?.transactions || 0} txs`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log(`🕐 Last Update: ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(60) + '\n');
  },
  
  error: (message: string, error?: Error) => {
    console.log(`❌ ERROR: ${message}`);
    if (error && process.env.LOG_LEVEL === 'debug') {
      console.log(error.stack);
    }
  }
};

// Create logs directory if it doesn't exist
import fs from 'fs';
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}