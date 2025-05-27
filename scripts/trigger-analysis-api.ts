// Create scripts/trigger-analysis-api.ts
import axios from 'axios';
import { db } from '../src/database/postgres';
import { logger } from '../src/utils/logger';

async function triggerAnalysis() {
  // First, make sure services are running
  try {
    const status = await axios.get('http://localhost:3000/analysis/stats');
    logger.info('Analysis service status:', status.data);
    
    if (!status.data.isRunning) {
      logger.error('Analysis service not running!');
      process.exit(1);
    }
  } catch (error) {
    logger.error('Could not connect to API. Is the server running?');
    process.exit(1);
  }

  // Get some pending tokens
  const pendingTokens = await db('tokens')
    .where('analysis_status', 'PENDING')
    .limit(5)
    .select('address', 'symbol');
    
  logger.info(`Found ${pendingTokens.length} pending tokens`);
  
  // For now, let's just check if re-analysis would help
  // In Module 2, we'll add an API endpoint to trigger analysis
  
  pendingTokens.forEach(token => {
    logger.info(`Pending: ${token.symbol} - ${token.address}`);
  });
  
  process.exit(0);
}

triggerAnalysis().catch(console.error);