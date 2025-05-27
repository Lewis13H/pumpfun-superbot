import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { Router } from 'express';
import { config } from './config';
import { logger, loggerStream } from './utils/logger';
import { healthRouter } from './api/health';
import { discoveryService } from './discovery/discovery-service';
import { analysisRouter } from './api/analysis';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Routes
app.use('/health', healthRouter);
app.use('/analysis', analysisRouter);

// Discovery routes
const discoveryRouter = Router();

discoveryRouter.get('/stats', (req, res) => {
  res.json(discoveryService.getStats());
});

discoveryRouter.post('/start', async (req, res) => {
  try {
    await discoveryService.start();
    res.json({ status: 'started' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to start discovery service:', error);
    res.status(500).json({ error: errorMessage });
  }
});

discoveryRouter.post('/stop', async (req, res) => {
  try {
    await discoveryService.stop();
    res.json({ status: 'stopped' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    logger.error('Failed to stop discovery service:', error);
    res.status(500).json({ error: errorMessage });
  }
});

// Add discovery routes to app
app.use('/discovery', discoveryRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.env === 'development' ? err.message : undefined,
  });
});

export { app };