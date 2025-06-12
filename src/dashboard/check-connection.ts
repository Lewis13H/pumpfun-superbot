// src/dashboard/check-connection.ts
// Debug script to check why gRPC isn't connecting to dashboard

import { logger } from '../utils/logger2';
import { db } from '../database/postgres';

async function checkConnections() {
  logger.info('🔍 Checking connections...');
  
  // Check database
  try {
    await db.raw('SELECT NOW()');
    logger.info('✅ Database connected');
    
    // Check token count
    const tokenCount = await db('tokens').count('* as count').first();
    logger.info(`📊 Total tokens: ${tokenCount?.count}`);
    
    // Check for price data
    const priceData = await db('timeseries.token_prices')
      .count('* as count')
      .where('time', '>', new Date(Date.now() - 60 * 60 * 1000))
      .first();
    logger.info(`📈 Price updates in last hour: ${priceData?.count}`);
    
    // Check for transactions
    const txData = await db('timeseries.token_transactions')
      .count('* as count')
      .where('time', '>', new Date(Date.now() - 60 * 60 * 1000))
      .first();
    logger.info(`💸 Transactions in last hour: ${txData?.count}`);
    
    // Check for system events
    const events = await db('system_events')
      .select('event_type', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);
    logger.info('📋 Recent system events:', events);
    
  } catch (error) {
    logger.error('❌ Database error:', error);
  }
  
  // Check if bot is running by looking for recent activity
  try {
    const recentActivity = await db('tokens')
      .where('last_price_update', '>', new Date(Date.now() - 5 * 60 * 1000))
      .count('* as count')
      .first();
    
    if (recentActivity && parseInt(String(recentActivity.count)) > 0) {
      logger.info(`✅ Bot appears to be running - ${recentActivity.count} tokens updated in last 5 minutes`);
    } else {
      logger.warn('⚠️ No recent token updates - bot may not be streaming data');
    }
  } catch (error) {
    logger.warn('Could not check bot activity');
  }
  
  logger.info('\n💡 If gRPC is not connecting:');
  logger.info('1. Ensure your bot is running with: npm run dev');
  logger.info('2. Check that the bot shows "gRPC stream connected" in its logs');
  logger.info('3. The dashboard needs to be restarted after the bot starts');
  logger.info('4. Try running: npm run dashboard:v428:full');
  
  process.exit(0);
}

checkConnections();