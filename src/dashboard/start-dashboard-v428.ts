// src/dashboard/v428-dashboard-start.ts
// V4.28: Simple dashboard startup script

import { logger } from '../utils/logger2';
import { db } from '../database/postgres';
import { DASHBOARD_SERVER } from './v428-dashboard-server';

async function startDashboard() {
  logger.info('🚀 Starting V4.28 Dashboard...');
  
  try {
    // Test database connection
    await db.raw('SELECT NOW()');
    logger.info('✅ Database connected');
    
    // Start dashboard server
    await DASHBOARD_SERVER.start();
    logger.info('✅ Dashboard server started');
    
    // Note: The dashboard will work with limited real-time features
    // To get full real-time updates, run your bot in parallel
    
    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down dashboard...');
      
      await DASHBOARD_SERVER.stop();
      await db.destroy();
      
      process.exit(0);
    });
    
    logger.info(`
    ========================================
    V4.28 Dashboard is running!
    
    Dashboard URL: http://localhost:${process.env.DASHBOARD_PORT || 3000}
    
    Note: For real-time updates, ensure your bot is running:
    npm run bot-v427
    
    The dashboard will display all available data from your database.
    
    Press Ctrl+C to stop
    ========================================
    `);
    
  } catch (error) {
    logger.error('Failed to start dashboard:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  startDashboard();
}

export { startDashboard };