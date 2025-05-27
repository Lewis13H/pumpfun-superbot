import { Router } from 'express';
import { analysisService } from '../analysis/analysis-service';
import { TokenAnalysisStorage } from '../analysis/analysis-storage';
import { logger } from '../utils/logger';

export const analysisRouter = Router();
const storage = new TokenAnalysisStorage();

// Get analysis stats
analysisRouter.get('/stats', (req, res) => {
  res.json(analysisService.getStats());
});

// Get token analysis history
analysisRouter.get('/token/:address', async (req, res) => {
  try {
    const history = await storage.getAnalysisHistory(req.params.address);
    res.json(history);
  } catch (error) {
    logger.error('Failed to get token analysis:', error);
    res.status(500).json({ error: 'Failed to retrieve analysis history' });
  }
});

// Get overall token statistics
analysisRouter.get('/token-stats', async (req, res) => {
  try {
    const stats = await storage.getTokenStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get token stats:', error);
    res.status(500).json({ error: 'Failed to retrieve token statistics' });
  }
});

// Force re-analysis of a token (for testing)
analysisRouter.post('/analyze/:address', async (req, res) => {
  try {
    // This would need to be implemented to fetch token from DB and queue it
    res.json({ message: 'Token queued for analysis' });
  } catch (error) {
    logger.error('Failed to queue token for analysis:', error);
    res.status(500).json({ error: 'Failed to queue token' });
  }
});